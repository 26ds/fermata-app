import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getCachedTranslation, putCachedTranslation } from "@/lib/translate/cache";
import { translateSegments, TranslateError, type TranslateProgress } from "@/lib/translate/gemini-translate";
import { isSupportedLang } from "@/lib/translate/langs";
import type { SourceRow, TranscriptSegment } from "@/lib/types";

// M2.9 双语字幕 —— 把一条已有字幕翻成目标语言的唯一入口。
//
// 形态照抄 /api/transcript：**流式 NDJSON**（翻一批推一批，用户看着译文长出来），
// (content_key, target_lang) 命中缓存则一次性吐、零成本零延迟；翻完整才回填缓存。
// 与字幕不同的是：译文不在 sources 上占状态列 —— 它是叠在字幕上的第二层，
// 客户端自己拿着显示，所以这条路只管「翻 + 缓存」，不写 source。

export const maxDuration = 300;

/** 软预算：留 60 秒收尾，绝不贴着 300 秒硬墙跑 */
const BUDGET_MS = 240_000;

const bodySchema = z.object({
  sourceId: z.string().uuid(),
  targetLang: z.string().min(2).max(12),
});

const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
} as const;

function line(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

function ndjsonOnce(payloads: unknown[]): Response {
  const text = payloads.map((p) => `${JSON.stringify(p)}\n`).join("");
  return new Response(text, { headers: NDJSON_HEADERS });
}

export async function POST(request: Request) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  }
  const { sourceId, targetLang } = parsed.data;
  if (!isSupportedLang(targetLang)) {
    return NextResponse.json({ error: "不支持的目标语言" }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "找不到这条内容" }, { status: 404 });
  }

  const source = row as SourceRow;
  const segments: TranscriptSegment[] = Array.isArray(source.transcript) ? source.transcript : [];
  if (segments.length === 0) {
    return NextResponse.json(
      { error: "这条内容还没有字幕，先生成字幕再翻译。" },
      { status: 400 },
    );
  }

  const contentKey = source.external_id;
  // content_lang 非空列，默认空串 —— 空串当「原文语言未知」，归 null
  const sourceLang = source.content_lang || null;

  // 目标语言就是原文语言 —— 不用翻，让客户端只显示原文
  if (sourceLang && sourceLang === targetLang) {
    return ndjsonOnce([{ type: "same-language", lang: targetLang }]);
  }

  // === 缓存优先：(内容, 语言) 别人翻过就直接白拿 ===
  if (contentKey) {
    const cached = await getCachedTranslation(supabase, contentKey, targetLang);
    if (cached) {
      return ndjsonOnce([
        { type: "start", total: cached.translations.length, existing: cached.translations.length, cached: true },
        { type: "done", complete: true, translations: cached.translations, cached: true },
      ]);
    }
  }

  const startedAt = Date.now();
  const remainingMs = () => BUDGET_MS - (Date.now() - startedAt);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: unknown) => {
        try {
          controller.enqueue(line(payload));
        } catch {
          /* 浏览器已经走了，不影响服务端把活干完（翻完还要回填缓存） */
        }
      };

      push({ type: "start", total: segments.length, existing: 0 });

      try {
        const result = await translateSegments({
          segments,
          targetLang,
          remainingMs,
          onPartial: async (progress: TranslateProgress) => {
            push({ type: "partial", ...progress });
          },
        });

        // 翻完整了才写回缓存，给后来人白拿（半截的会坑下一个人）
        if (result.complete && contentKey) {
          await putCachedTranslation(supabase, contentKey, targetLang, result.translations, sourceLang);
        }
        push({
          type: "done",
          complete: result.complete,
          translations: result.translations,
          note: result.note ?? null,
        });
      } catch (e) {
        // 该讲给用户听的原因（额度/限流/没字幕）→ 原样告诉他；其它异常也说人话
        const message =
          e instanceof TranslateError
            ? e.message
            : `翻译时出错了：${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
        push({ type: "error", message });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

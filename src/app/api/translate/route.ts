import { NextResponse } from "next/server";
import { z } from "zod";
import { langLabel, normalizeLang } from "@/lib/lang";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getCachedTranslation, putCachedTranslation } from "@/lib/translate/cache";
import { translateSegments, TranslateError, type TranslateProgress } from "@/lib/translate/gemini-translate";
import { isSupportedLang } from "@/lib/translate/langs";
import type { SourceRow, TranscriptSegment } from "@/lib/types";
import { getLangPrefs } from "@/lib/settings";
import {
  conformHan,
  displayedHanScript,
  hanScriptOf,
  looksChinese,
  planZhScript,
  scriptOfText,
} from "@/lib/zh-script";

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
  // 空 = 原文语言未知（还没转写，或模型没报），归 null。
  // **M3.7 加了归一化**（D42）：转写模型报的是 `"english"` 这样的全称，而目标语言是 `"en"` ——
  // 不归一的话下面那个"同语言"判断永远不成立，等于花钱把英文翻成英文。
  const sourceLang = normalizeLang(source.content_lang) || null;
  const targetScript = hanScriptOf(targetLang);

  // 目标语言就是原文语言 —— 不用翻，让客户端只显示原文。
  // **中文不在此列**（`!targetScript`）：中文里"同一门语言"还分两套字形，
  // 这一句会把「屏幕上是简体、他要繁体」误判成不用翻。中文交给下面那段。
  if (!targetScript && sourceLang && sourceLang === normalizeLang(targetLang)) {
    return ndjsonOnce([{ type: "same-language", lang: targetLang }]);
  }

  // === 中文 → 中文：换字形，不是翻译（D50） ===
  //
  // **这里原来写着"精确比较，不用 sameLang，因为简体→繁体是真的要转换的"。那条已作废。**
  // 2026-08-07 真机量到的后果：把一份繁体字幕连同「翻成简体中文」的指令丢给 Gemini，
  // 它认为中文翻中文无事可做，**原样抄回来**（只把半角逗号改成全角）。
  //
  // 认"是不是中文"要多一层：`content_lang` 对 YouTube **基本都是 null**
  // （`gemini-youtube` 从不报语言），所以原文语言不知道时看字幕本身像不像中文。
  const sample = segments.slice(0, 40).map((s) => s.text).join("");
  const sourceIsChinese = sourceLang ? sourceLang.startsWith("zh") : looksChinese(sample);

  if (targetScript && sourceIsChinese) {
    // 比的是**屏幕上那份**（读侧转换已按他的语言调过），不是库里存的那份。
    // 库里存的是哪套，只决定这一趟花不花钱。
    const storedScript = scriptOfText(sample);
    const plan = planZhScript({
      targetScript,
      storedScript,
      displayScript: displayedHanScript(await getLangPrefs(supabase, user.id), storedScript),
    });

    if (plan.kind === "already") {
      return ndjsonOnce([
        {
          type: "same-language",
          lang: targetLang,
          note: `你现在看的字幕已经是${langLabel(targetLang)}了。`,
        },
      ]);
    }

    // **这一条是整件事变便宜的关键**：转写存下来的原文常常已经就是他要的那一套
    // （他那支视频存的就是繁体、屏幕上显示的是简体），那就原样奉还 ——
    // 零成本、零延迟、**逐字精确**，一次转换都不用做。繁→简则查表，同样免费且精确。
    if (plan.kind === "free") {
      const translations = segments.map((s, i) => ({
        i,
        start: s.start,
        text: conformHan(s.text, targetScript),
      }));
      return ndjsonOnce([
        { type: "start", total: translations.length, existing: translations.length, cached: true },
        { type: "done", complete: true, translations, cached: true },
      ]);
    }
    // plan.kind === "model"：只剩「库里是简体、他要繁体」这一种。这个方向有真歧义
    // （发→髮/發、干→乾/幹、里→裡/里…），查表必然写出错字，只能花一次钱问模型。
    // 走下面那条常规管线，提示词换成"换字形"（`scriptOnly`），照常进缓存 —— 一支片子只付一次。
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
          // D50：中文→中文走到这里只剩「简体→繁体」一种，那是换字形不是翻译
          scriptOnly: sourceIsChinese && hanScriptOf(targetLang) !== null,
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

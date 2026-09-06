import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeLang } from "@/lib/lang";
import { getLangPrefs } from "@/lib/settings";
import { conformSegments } from "@/lib/zh-convert";
import { captionScriptFor } from "@/lib/zh-script";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { providersFor } from "@/lib/transcript/registry";
import { getCachedTranscript, putCachedTranscript } from "@/lib/transcript/cache";
import { TranscribeError, type TranscriptProgress } from "@/lib/transcript/types";
import { MAX_SEGMENTS } from "@/lib/captions";
import type { SourceRow, TranscriptSegment } from "@/lib/types";

// M2a — 字幕生成的唯一入口。WORKORDER §4 的 Provider 链在这里被驱动。
//
// 形态是**流式 NDJSON**，一行一个事件：出一块就推一块，用户看得见字幕在长，
// 而不是盯着转圈等三分钟。每一块同时落库 —— 连接断了、页面关了，
// 已转好的部分**已经在库里**，下次打开接着来。

/** Vercel Hobby 的硬顶就是 300 秒（实测文档），到点 504 */
export const maxDuration = 300;

/** 软预算：留 60 秒给收尾与落库，绝不贴着硬墙跑 */
const BUDGET_MS = 240_000;

/** 花钱与配额的护栏：再长的内容也不无限转下去 */
const MAX_CONTENT_S = 4 * 3600;

const bodySchema = z.object({
  sourceId: z.string().uuid(),
  /** 播放器就绪后客户端才知道真实时长，比库里的新，优先用它 */
  durationS: z.number().positive().max(24 * 3600).optional(),
  /**
   * 只查缓存、不花钱转（D31）。YouTube 打开时客户端用它免费探一下：
   * 别人转过就直接白拿，没人转过就此打住，等用户按「生成字幕」再花钱。
   */
  cacheOnly: z.boolean().optional(),
});

const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  // 别让任何中间层攒着不发 —— 流式的意义就在于第一块立刻到屏幕上
  "x-accel-buffering": "no",
} as const;

function line(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

/** 一次性把几行 NDJSON 直接吐完（缓存命中 / cacheOnly 未命中，不需要开流慢慢推） */
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

  const { data: row } = await supabase
    .from("sources")
    .select("*")
    .eq("id", parsed.data.sourceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "找不到这条内容" }, { status: 404 });
  }

  const source = row as SourceRow;
  if (source.transcript_status === "ready") {
    return NextResponse.json({ status: "ready", skipped: true });
  }

  const chain = providersFor(source.kind);
  if (chain.length === 0) {
    return NextResponse.json(
      { error: `这类内容（${source.kind}）的字幕还没接上` },
      { status: 400 },
    );
  }

  // 客户端知道更准的时长就用它，顺手回写（oEmbed 给不了时长，播放器才知道）
  const durationS = parsed.data.durationS ?? source.duration_s ?? null;
  if (durationS && durationS !== source.duration_s) {
    source.duration_s = Math.round(durationS);
    void supabase
      .from("sources")
      .update({ duration_s: Math.round(durationS) })
      .eq("id", source.id)
      .eq("user_id", user.id);
  }

  if (durationS && durationS > MAX_CONTENT_S) {
    return NextResponse.json(
      { error: "这条内容超过 4 小时，暂时不自动转写 —— 可以手动粘贴字幕。" },
      { status: 400 },
    );
  }

  // D50：**落库存原样，推给浏览器的转成他的字形。** 两件事分开是有意的 ——
  // 库里那份是这条内容的底本（还要回填跨用户缓存），而屏幕上那份该按看的人来。
  const hanScript = captionScriptFor(await getLangPrefs(supabase, user.id));
  const forScreen = (segs: TranscriptSegment[]) => conformSegments(segs, hanScript);

  const startedAt = Date.now();
  const remainingMs = () => BUDGET_MS - (Date.now() - startedAt);

  const save = async (segments: TranscriptSegment[], status: string, lang?: string | null) => {
    const patch: Record<string, unknown> = {
      transcript: segments.slice(0, MAX_SEGMENTS),
      transcript_status: status,
    };
    // D42：模型报的可能是 `"english"` 这种全称，落库前归一成码 —— 库里三种写法混着，
    // 后面"这条内容是不是他母语"的判断就没法做了
    if (lang) patch.content_lang = normalizeLang(lang);
    await supabase.from("sources").update(patch).eq("id", source.id).eq("user_id", user.id);
  };

  // === 缓存优先（D31）：同一支内容别人转过，就直接白拿，零成本零延迟。 ===
  // content_key = external_id（youtube=videoId / podcast=feedUrl#guid），跨用户共享。
  const contentKey = source.external_id;
  const cacheOnly = parsed.data.cacheOnly === true;
  if (contentKey) {
    const cached = await getCachedTranscript(supabase, contentKey);
    if (cached) {
      await save(cached.segments, "ready", cached.lang);
      return ndjsonOnce([
        { type: "start", existing: cached.segments.length, totalS: durationS, cached: true },
        // 缓存里那份是**底本**（跨用户共享，没有字形维度）—— 落库存原样，上屏转字形
        { type: "done", provider: "cache", complete: true, segments: forScreen(cached.segments), cached: true },
      ]);
    }
  }
  // 只查缓存的那次（YouTube 打开时免费探一下）：没命中就此打住，绝不自动花钱转。
  if (cacheOnly) {
    return ndjsonOnce([{ type: "start", existing: 0, totalS: durationS }, { type: "miss" }]);
  }

  // 走到这才真要花钱转 —— 现在才占坑：状态置 partial。浏览器只在 pending / failed
  // 时自动敲，所以这一步同时挡住了"两个标签页同时开转"的重复消费。
  await supabase
    .from("sources")
    .update({ transcript_status: "partial" })
    .eq("id", source.id)
    .eq("user_id", user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端断开后再往 controller 写会抛，吞掉即可 —— 落库照常进行
      const push = (payload: unknown) => {
        try {
          controller.enqueue(line(payload));
        } catch {
          /* 浏览器已经走了，不影响服务端把活干完 */
        }
      };

      const existing = Array.isArray(source.transcript) ? source.transcript : [];
      push({ type: "start", existing: existing.length, totalS: durationS });

      for (const provider of chain) {
        if (!provider.supports(source)) continue;
        try {
          const result = await provider.transcribe({
            source,
            existing,
            remainingMs,
            onPartial: async (progress: TranscriptProgress) => {
              await save(progress.segments, "partial");
              push({ type: "partial", ...progress, segments: forScreen(progress.segments) });
            },
          });

          const status = result.complete ? "ready" : "partial";
          await save(result.segments, status, result.lang);
          // 转完整了就写回缓存，给后来人白拿（只写 complete 的，半截的会坑下一个人）
          if (result.complete && contentKey) {
            await putCachedTranscript(supabase, contentKey, source.kind, result.segments, result.lang);
          }
          push({
            type: "done",
            provider: provider.name,
            complete: result.complete,
            segments: forScreen(result.segments),
            note: result.note ?? null,
          });
          controller.close();
          return;
        } catch (e) {
          // 该讲给用户听的原因 → 记 failed 并原样告诉他；其余异常换下一个 Provider
          if (e instanceof TranscribeError) {
            await save(existing, "failed");
            // `permanent` = 重试也回同一句（视频读不了那一类）。界面靠它决定
            // 主按钮是「重试」还是「粘贴字幕」—— 别让人对着死路一直点。
            push({ type: "error", message: e.message, permanent: e.permanent });
            controller.close();
            return;
          }
          push({ type: "note", message: `${provider.name} 没成，换下一个` });
        }
      }

      await save(existing, "failed");
      push({ type: "error", message: "所有字幕来源都没成。可以手动粘贴字幕，或稍后重试。" });
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

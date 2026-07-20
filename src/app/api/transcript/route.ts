import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { providersFor } from "@/lib/transcript/registry";
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
});

function line(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
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

  // 占坑：状态先置 partial。浏览器只在 pending / failed 时自动敲，
  // 所以这一步同时挡住了"两个标签页同时开转"的重复消费。
  await supabase
    .from("sources")
    .update({ transcript_status: "partial" })
    .eq("id", source.id)
    .eq("user_id", user.id);

  const startedAt = Date.now();
  const remainingMs = () => BUDGET_MS - (Date.now() - startedAt);

  const save = async (segments: TranscriptSegment[], status: string, lang?: string | null) => {
    const patch: Record<string, unknown> = {
      transcript: segments.slice(0, MAX_SEGMENTS),
      transcript_status: status,
    };
    if (lang) patch.content_lang = lang;
    await supabase.from("sources").update(patch).eq("id", source.id).eq("user_id", user.id);
  };

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
              push({ type: "partial", ...progress });
            },
          });

          const status = result.complete ? "ready" : "partial";
          await save(result.segments, status, result.lang);
          push({
            type: "done",
            provider: provider.name,
            complete: result.complete,
            segments: result.segments,
            note: result.note ?? null,
          });
          controller.close();
          return;
        } catch (e) {
          // 该讲给用户听的原因 → 记 failed 并原样告诉他；其余异常换下一个 Provider
          if (e instanceof TranscribeError) {
            await save(existing, "failed");
            push({ type: "error", message: e.message });
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

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // 别让任何中间层攒着不发 —— 流式的意义就在于第一块立刻到屏幕上
      "x-accel-buffering": "no",
    },
  });
}

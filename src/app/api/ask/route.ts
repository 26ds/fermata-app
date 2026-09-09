import { NextResponse } from "next/server";
import { z } from "zod";
import { askQuestion, AskError } from "@/lib/ask/gemini-ask";
import { getLangPrefs } from "@/lib/settings";
import { conformSegments } from "@/lib/zh-convert";
import { captionScriptFor } from "@/lib/zh-script";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow, TranscriptSegment } from "@/lib/types";
import { getT } from "@/lib/ui-lang";
import { tMaybeKey } from "@/lib/copy";

// M3 打断问答 —— 用户在某个打断点上打字问一句，Gemini Flash 扣着当前字幕流式作答。
//
// 形态照抄 /api/transcript、/api/translate：**流式 NDJSON**（答案逐块上屏）。
// 答完整了才把 question + ai_answer 写回这条 interrupts 行（半截答案不落库，别坑复习）。
// 接地范围由这行的 window_start_s / window_end_s（D5 落库时定死）+ 全文一起给引擎。

export const maxDuration = 300;

const bodySchema = z.object({
  interruptId: z.string().uuid(),
  question: z.string().trim().min(1, "err.needQuestion").max(2000),
});

const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
} as const;

function line(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

export async function POST(request: Request) {
  const t = await getT();
  if (!supabaseConfigured) {
    return NextResponse.json({ error: t("err.noSupabase") }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: t("err.needLogin") }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: tMaybeKey(t, parsed.error?.issues[0]?.message, "err.badRequest") },
      { status: 400 },
    );
  }
  const { interruptId, question } = parsed.data;

  // 这条打断点（RLS + user_id 双保险，别人的点问不了）—— 窗口就从这行拿
  const { data: interrupt } = await supabase
    .from("interrupts")
    .select("id, source_id, t_s, window_start_s, window_end_s, question_mode")
    .eq("id", interruptId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!interrupt) {
    return NextResponse.json({ error: t("err.noInterruptPoint") }, { status: 404 });
  }

  // 内容的字幕
  const { data: srcRow } = await supabase
    .from("sources")
    .select("*")
    .eq("id", interrupt.source_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!srcRow) {
    return NextResponse.json({ error: t("err.noSource") }, { status: 404 });
  }
  const source = srcRow as SourceRow;
  const raw: TranscriptSegment[] = Array.isArray(source.transcript) ? source.transcript : [];
  if (raw.length === 0) {
    return NextResponse.json(
      { error: t("err.noCaptionsAsk") },
      { status: 400 },
    );
  }

  // D42：答案用哪门语言是**已知事实**（他自己设的母语），不该让模型从问句猜
  const prefs = await getLangPrefs(supabase, user.id);
  // D50：喂给模型的字幕也调成他看到的那套字形 —— 他屏幕上是简体，AI 回头引用原句
  // 却蹦出繁体，那是同一个 bug 的另一张脸
  const segments = conformSegments(raw, captionScriptFor(prefs));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: unknown) => {
        try {
          controller.enqueue(line(payload));
        } catch {
          /* 浏览器已经走了，不影响服务端把答案收完再落库 */
        }
      };

      try {
        const answer = await askQuestion({
          question,
          segments,
          windowStartS: Number(interrupt.window_start_s),
          windowEndS: Number(interrupt.window_end_s),
          tS: Number(interrupt.t_s),
          title: source.title,
          nativeLang: prefs.nativeLang,
          onChunk: async (text) => push({ type: "chunk", text }),
        });

        // 答完整才落库：写回这条打断点的问题与答案，复习时要用（WORKORDER 283）。
        // question_mode 之前空着的话，标成 free（自由提问）。
        await supabase
          .from("interrupts")
          .update({
            question,
            ai_answer: answer,
            question_mode: interrupt.question_mode ?? "free",
          })
          .eq("id", interruptId)
          .eq("user_id", user.id);

        push({ type: "done", answer });
      } catch (e) {
        const message =
          e instanceof AskError
            ? e.message
            : t("err.answerFailed", e instanceof Error ? e.message.slice(0, 120) : String(e));
        push({ type: "error", message });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

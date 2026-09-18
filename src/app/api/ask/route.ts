import { NextResponse } from "next/server";
import { z } from "zod";
import { askQuestion, AskError } from "@/lib/ask/gemini-ask";
import { lookClip } from "@/lib/look";
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
  /**
   * D56「说短一点」（M3.15 片 b）：**同一个问题、同一份 context，重答一版更短的**。
   *
   * 和普通一趟只差一件事，但那件事是这条决策的命根子：**这一趟不写库**。
   * 原答案必须原地不动 —— 用户要能来回切回去看长的那版。
   * 短版活在浏览器里，刷新就没（0011 没给它留列，也不该为它加一列：
   * 它是"再看一眼"的临时视图，不是这一轮问答的事实）。
   */
  brief: z.boolean().optional(),
  /**
   * M3.16「看画面再答」（D75）：**这一趟把提问前后那一段视频也交给模型看**。只认 YouTube。
   *
   * 和 `brief` 一样只差一件事要记牢：**写的是 `ai_answer_visual`，不碰 `ai_answer`**（迁移 0013）——
   * 创始人选的是「两版都留、来回切、都存库」。`look + brief` 是看画面那版的短版：照 D56，一个字都不写。
   */
  look: z.boolean().optional(),
});

/**
 * 迁移 0013 没跑、`ai_answer_visual` 这一列还不存在时 Supabase 回的是哪种错：
 * PostgREST 在自己的 schema 缓存里找不到列 → `PGRST204`；直通到 Postgres → `42703`。
 * 认出来是为了说清楚是这一种（D44）—— 答案照样给他看，钱已经花了
 */
const isMissingColumn = (e: { code?: string } | null) => e?.code === "PGRST204" || e?.code === "42703";

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
  const { interruptId, question, brief, look } = parsed.data;

  // 这条打断点（RLS + user_id 双保险，别人的点问不了）—— 窗口就从这行拿。
  // `ai_answer` 是给「看画面再答」用的：把只看字幕那版一起交给模型（D75）
  const { data: interrupt } = await supabase
    .from("interrupts")
    .select("id, source_id, t_s, window_start_s, window_end_s, question_mode, ai_answer")
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
  // 看画面只认 YouTube（播客没有画面；界面上那颗按钮也只在 YouTube 上出现）
  if (look && (source.kind !== "youtube" || !source.url)) {
    return NextResponse.json({ error: t("err.lookNotVideo") }, { status: 400 });
  }
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
        const tS = Number(interrupt.t_s);
        const answer = await askQuestion({
          question,
          segments,
          windowStartS: Number(interrupt.window_start_s),
          windowEndS: Number(interrupt.window_end_s),
          tS,
          title: source.title,
          nativeLang: prefs.nativeLang,
          brief,
          // 看哪一段由 `lib/look.ts` 算 —— 界面角标上写的「02:45–02:57」是同一个函数算的
          look:
            look && source.url
              ? { url: source.url, ...lookClip(tS, source.duration_s), previousAnswer: interrupt.ai_answer ?? null }
              : undefined,
          onChunk: async (text) => push({ type: "chunk", text }),
        });

        // 答完整才落库：写回这条打断点的问题与答案，复习时要用（WORKORDER 283）。
        // question_mode 之前空着的话，标成 free（自由提问）。
        //
        // ⚠️ **「说短一点」这一趟一个字都不写**（D56）：它是同一轮问答的另一种看法，
        // 不是新的事实。写进去就把原答案盖掉了 —— 那正是这条决策明确不许的
        // （「原答案不覆盖、可来回切」）。看画面那版的短版（`look + brief`）同理。
        if (look && !brief) {
          // 看画面那一版：**只写 `ai_answer_visual`**，只看字幕那版原地不动（D75：两版都留、都存库）。
          // 写不进去要说出来，而且分得清是哪一种（D44）—— 答案照样推给他：钱已经花了，
          // 至少这一次观看里看得到；只是刷新之后就没了，这件事必须当场告诉他
          const { error: saveError } = await supabase
            .from("interrupts")
            .update({ ai_answer_visual: answer })
            .eq("id", interruptId)
            .eq("user_id", user.id);
          if (saveError) {
            push({
              type: "warn",
              message: isMissingColumn(saveError) ? t("err.lookNotSavedDb") : t("err.lookNotSaved"),
            });
          }
        } else if (!brief) {
          await supabase
            .from("interrupts")
            .update({
              question,
              ai_answer: answer,
              question_mode: interrupt.question_mode ?? "free",
            })
            .eq("id", interruptId)
            .eq("user_id", user.id);
        }

        push({ type: "done", answer });
      } catch (e) {
        // 看画面那一趟撞上「视频读不了」：说的是**这一种**，而且告诉他只看字幕那版还在（D75）——
        // 不用 explainGeminiError 那句「自动转写只收公开视频」：他点的不是转写
        const message =
          e instanceof AskError && e.unreadable
            ? t("err.lookUnreadable")
            : e instanceof AskError
              ? e.message
              : t("err.answerFailed", e instanceof Error ? e.message.slice(0, 120) : String(e));
        push({ type: "error", message });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

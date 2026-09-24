import { NextResponse } from "next/server";
import { z } from "zod";
import { askQuestion, AskError } from "@/lib/ask/gemini-ask";
import { pastTurns, RECENT_TURNS, type HistoryRow, type PastTurn } from "@/lib/ask/history";
import { refsStream, settleAnswer, splitRefsBlock } from "@/lib/ask/refs";
import { readRefs, splitAnswer } from "@/lib/answer-refs";
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
  /**
   * M3.15 片 c（D64）：「视频别处还讲到」要成**概述卡**（只有宽屏问答栏传）。
   * 模型把指路写成答案后面一段结构化的东西；这里把它挡在流外面、拿原句去字幕里核对、
   * 吸附后存进 `interrupts.refs`，全文末尾再留一份文字版（历史页那些不画卡片的地方照样看得见）。
   * 手机上的暂停面板不传 —— 它拿到的答案和以前一个字都不差。
   */
  cards: z.boolean().optional(),
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

/**
 * D77：从 `interrupts` 取之前几轮 —— 母问题那一轮 + 这一轮**之前**最近三轮。挑、拆、截在 `lib/ask/history.ts`。
 * 只取这一轮之前的：「说短一点」「看画面再答」点在老的一轮上时，带的是那一轮当时的上下文，不是后来才问的。
 * `select("*")`：0013 没跑的库上没有 `ai_answer_visual`，点名要它整条查询就挂了（观看页取这张表也是 `*`）。
 * 取不到不拦这一问（答案照给），但要说出来（D44）—— 调用方看 `failed`
 */
async function loadHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  turn: { id: string; source_id: string; parent_id: string | null; created_at: string },
): Promise<{ turns: PastTurn[]; failed: boolean }> {
  const [recent, parent] = await Promise.all([
    supabase
      .from("interrupts")
      .select("*")
      .eq("source_id", turn.source_id)
      .eq("user_id", userId)
      .neq("id", turn.id)
      .not("question", "is", null)
      .not("ai_answer", "is", null)
      .lt("created_at", turn.created_at)
      .order("created_at", { ascending: false })
      .limit(RECENT_TURNS),
    turn.parent_id
      ? supabase.from("interrupts").select("*").eq("id", turn.parent_id).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (recent.error || parent.error) return { turns: [], failed: true };
  return { turns: pastTurns((recent.data ?? []) as HistoryRow[], (parent.data as HistoryRow | null) ?? null), failed: false };
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
  const { interruptId, question, brief, look, cards } = parsed.data;
  // 这一趟出概述卡吗：只有「按卡片问」的正经一问才出（短版不写第②段；看画面那版的卡片已经在只看字幕那版上）
  const withRefs = Boolean(cards) && !brief && !look;
  // 片 d 的另一半（D65）：问题分类跟着**同一趟**出、同一句 update 落库。只有正经一问标 ——
  // 「说短一点」「看画面再答」问的还是那个问题，标签早就有了（他改过的更不能被重答一次冲掉）；手机暂停面板不带 `cards`，一个字不变
  const withKinds = withRefs;
  // 宽屏问答栏来的吗：正经一问带 `cards`、「说短一点」带 `brief`、「看画面再答」带 `look` —— 手机暂停面板三样都不带，
  // 它的请求和以前逐字节相同。只有这一路带上之前的对话（D77）、立「不许猜是谁说的」（D76）
  const fromRail = Boolean(cards || brief || look);

  // 这条打断点（RLS + user_id 双保险，别人的点问不了）—— 窗口就从这行拿。
  // `ai_answer` 是给「看画面再答」用的：把只看字幕那版一起交给模型（D75）；`refs` 用来拆掉它末尾的卡片文字版（D76）；
  // `parent_id` / `created_at` 给 D77 挑之前几轮
  const { data: interrupt } = await supabase
    .from("interrupts")
    .select("id, source_id, t_s, window_start_s, window_end_s, question_mode, ai_answer, refs, parent_id, created_at")
    .eq("id", interruptId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!interrupt) {
    return NextResponse.json({ error: t("err.noInterruptPoint") }, { status: 404 });
  }
  // D77：之前几轮，和下面取字幕、取语言设置同时跑 —— 别让每一问多等一趟数据库
  const historyP = fromRail
    ? loadHistory(supabase, user.id, interrupt).catch(() => ({ turns: [] as PastTurn[], failed: true }))
    : null;

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

      // 按卡片问的那两趟（正经一问 / 看画面）：指路那一段（`[[REFS]]` 起）和最后那行分类（`[[KINDS]]`，片 d）**不上屏** ——
      // 它们会变成卡片和标签；看画面那趟本来就叫模型别写，万一写了也不让它漏出去
      const splitter = cards ? refsStream((text) => push({ type: "chunk", text })) : null;

      try {
        // D77：之前几轮没取到 —— 这一问照答（字幕都在），但它看不到前面聊过什么，得说出来（D44）。
        // 排在最前面推：写库失败的那句要是也来了，会盖掉这一句（那一句更要紧）
        const history = historyP ? await historyP : null;
        if (history?.failed) push({ type: "warn", message: t("err.askNoHistory") });

        const tS = Number(interrupt.t_s);
        const raw = await askQuestion({
          question,
          segments,
          windowStartS: Number(interrupt.window_start_s),
          windowEndS: Number(interrupt.window_end_s),
          tS,
          title: source.title,
          nativeLang: prefs.nativeLang,
          brief,
          // 看哪一段由 `lib/look.ts` 算 —— 界面角标上写的「02:45–02:57」是同一个函数算的。
          // 上一版答案拆掉末尾的卡片文字版再给（D76）：那几行 note 正是猜说话人的重灾区（「Maverick 在催促 Rooster」），
          // 这一趟又不写指路 —— 留着只会把猜错的名字带进画面版
          look:
            look && source.url
              ? {
                  url: source.url,
                  ...lookClip(tS, source.duration_s),
                  previousAnswer: interrupt.ai_answer
                    ? splitAnswer(interrupt.ai_answer, readRefs(interrupt.refs)).body
                    : null,
                }
              : undefined,
          cards,
          kinds: withKinds,
          history: history?.turns,
          noSpeakerGuess: fromRail,
          onChunk: async (text) => (splitter ? splitter.push(text) : push({ type: "chunk", text })),
        });
        await splitter?.end();

        // 片 c：拆出指路 → 拿原句去字幕里核对、吸附（D64）→ 要落库的全文 = 正文 + 每张卡一行字。
        // 核对用的是上面喂给模型的**同一份**字幕（D50 字形转换过的），否则简体问句引繁体字幕永远核不上。
        // 片 d：最后那行分类（`[[KINDS]]`）也在这儿摘掉 —— 它进 `kinds` 那一列，答案全文里一个字不留
        const settled = withRefs ? settleAnswer(raw, segments, source.duration_s) : null;
        const answer = settled ? settled.stored : cards ? splitRefsBlock(raw).body : raw;
        // `null` = 模型这一趟没写分类那一行：那一列不碰（新问题本来就是空的，界面显示「＋ 标签」让他自己点）
        const kinds = withKinds && settled ? settled.kinds : null;

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
          // 片 c：按卡片问的这一趟连概述卡一起写（`refs`，迁移 0011 就留好的列）。
          // `[]` 也写：它和 null 不一样 —— [] = 按卡片问过、别处没讲到；null = 老数据 / 手机上问的
          const { error: saveError } = await supabase
            .from("interrupts")
            .update({
              question,
              ai_answer: answer,
              question_mode: interrupt.question_mode ?? "free",
              ...(settled ? { refs: settled.refs } : {}),
              // 片 d（D65）：和答案同一句写 —— 要么一起存上、要么一起没存上（没存上下面那句 warn 照说）
              ...(kinds ? { kinds } : {}),
            })
            .eq("id", interruptId)
            .eq("user_id", user.id);
          // 写失败了要说出来（D44）—— 以前这里的返回值没人看：界面照样显示答案，刷新之后那一问的答案就没了，
          // 一个字都不说（M3.15-log 🐞 3，片 c 在改这一行时一起补上）。答案照样推：钱已经花了。
          // 手机上的暂停面板不认 `warn`（它只读 chunk / done / error），那边照旧 —— 手机一个字不变
          if (saveError) {
            push({
              type: "warn",
              message: isMissingColumn(saveError) ? t("err.answerNotSavedDb") : t("err.answerNotSaved"),
            });
          }
        }

        // 概述卡排在 done 前面：界面收到 done 时手里已经有卡片，全文末尾那几行字才拆得掉（`splitAnswer`）
        if (settled) push({ type: "refs", refs: settled.refs });
        // 分类也排在 done 前面：问答栏在「答完那一拍」把标签挂到他那句问题下面（D65）
        if (kinds) push({ type: "kinds", kinds });
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

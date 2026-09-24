"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AtPicker } from "@/components/at-picker";
import { useCopy } from "@/components/copy-provider";
import { KindTags, type Tagging } from "@/components/kind-tags";
import type { PausePoint } from "@/components/pause-list";
import { RefCards } from "@/components/ref-cards";
import { type AnswerRef, readRefs, splitAnswer } from "@/lib/answer-refs";
import { type AtRead, atEntries, isTypingAt, notPinned, readAt, rewindTo, withAt, withoutAt } from "@/lib/at-time";
import { toSegments } from "@/lib/chat-text";
import { lookClip } from "@/lib/look";
import { readKinds } from "@/lib/question-kinds";
import { hms, mmss } from "@/lib/time";
import type { QuestionKind } from "@/lib/types";

// M3.15 片 b —— 右栏第一栏「问答」的**本体**（计划 §B，D61 / D62 / D63 / D56）。
//
// 片 a 给的是壳（三个 tab、各记各的滚动位置）；这里长出真的那条聊天线。
// **只在宽屏挂载**，手机上一个字都没变（那边照旧走暂停面板 + 沉浸聊天）。
//
// ── 这一栏和沉浸聊天的关系（别搞混，它们是两套） ────────────────────────────
// 沉浸聊天（`immersive-chat.tsx`）写的是 `chats.messages`，一整层磨砂浮层，
// 手机上还活着。这一栏写的是 **`interrupts`** —— D62：**每一轮问答就是一个捕获点**。
// 所以问完一句，点点条上当场多一个点，`/library/[id]` 的暂停点列表也跟着变厚，
// **不用再另存一份**。老的 `chats` 记录只读地混进来（见下面 `oldTurns`）。
//
// ── 四件必须一起成立的事 ──────────────────────────────────────────────────
// ① **一问就暂停**（D33 的老规矩，没改）：发送那一刻的播放头 = 这一轮的 `t_s`。
// ② **`@11:06` 可点，就地 seek，绝不换路由**（D33 死线：播放器实例永不卸载）。
// ③ **被链接送走就留返回牌**（D63）。片 c0 起：钉着的那块归 `qa-rail.tsx` 管（三个栏共用），
//    在这一栏里它仍然长在输入框上面；流里那条灰线「从 X 跳到了 Y」搬进了「互动记录」，而且落库（D71）。
// ④ **答完之后才出现三连**（计划 §B.6）：为什么会这样 / 跟刚才那段什么关系 / 说短一点。
//
// ── 2026-09-13 创始人真机反馈这一轮改的（字号 / 气泡 / 输入框）──────────────────────
// 「聊天框字体太小」「要把我们问的问题用气泡框框起来，ai 的回复不需要，这样用于区分」。
// 字从 12px 提到 14px（问、答、输入框一起）；提问装进右边一个气泡、回答照旧不套框。
// 那一轮还把追问缩进拿掉了（D72）—— 2026-09-18 他要回来了：「问答栏也缩进」，线再亮一点。
//
// ── M3.16「看画面再答」（D75，2026-09-18 冻结）────────────────────────────────
// 答完之后三连旁边多一颗：**用户自己点、点了才花钱**，把提问前后十来秒的视频也交给模型看。
// 看了画面那版**另存一列**（`ai_answer_visual`，迁移 0013），和只看字幕那版（`ai_answer`）**两版都留、来回切**，
// 切换不花钱。花钱的那颗只挂最后一轮；切换哪一轮有画面版就挂在哪一轮。只在 YouTube 上出现。
//
// ── M3.15 片 c：概述卡（计划 §二 / D64）──────────────────────────────────────
// 答案里「视频别处还讲到」那一段**不再是一段话，是卡片**（`ref-cards.tsx`）：服务端拿原句去字幕里核对、吸附，
// 核对上的可点（就地跳 + 返回牌，互动记录记「点概述卡」），核不上的灰着说清楚。
// 卡片跟着**这一轮**走：只看字幕那版、看画面那版下面都挂（它们指的是视频里的地方，不是哪一版答案）；短版下面不挂（短版本来就不写这一段）。
// 全文末尾还留着一份文字版给历史页（`answer-refs.ts` 文件头），这里用 `splitAnswer` 拆掉、换成卡片。

/** 连着几轮 `t_s` 挨得这么近就不重复标 `@`（D55 原有的防吵规则，计划 §B.2） */
const REPEAT_LABEL_GAP_S = 30;

/**
 * 提问的气泡（创始人 2026-09-13：「要把我们问的问题用气泡框框起来，ai 的回复不需要，这样用于区分」）。
 * 2026-08-01 那条「提问靠右、回答靠左」照旧成立，气泡是加在它上面的第二道区分。
 * 用 ink-700 不用青色：青色在这一页只答「能点 / 是个捕获点」（颜色一物一义），气泡两样都不是。
 * `[overflow-wrap:anywhere]`：一长串网址也得在气泡里折行，不许把这一栏撑出横向滚动条。
 */
const BUBBLE =
  "font-chat min-w-0 whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink-700 px-3 py-1.5 text-[1em] leading-[1.7143] text-ink-100 [overflow-wrap:anywhere]";

/**
 * 答案头上的小角标（「短版」、D75 的「看了画面 · 02:45–02:57」/「只看了字幕」）。
 * 灰底不用青色：青色在这一页只答「能点 / 是个捕获点」，角标两样都不是
 */
const TAG = "inline-block rounded bg-ink-700/70 px-1.5 py-0.5 text-[0.7086em] text-ink-300";

/** 输入框最多长到这么高（和它的 `max-h-24` 同一个数），再多才出滚动条 */
const INPUT_MAX_PX = 96;

/** 老沉浸聊天的一条逐字记录（`chats.messages`）—— 只读 */
interface OldTurn {
  role: "user" | "assistant";
  text: string;
  at_s?: number;
}

/**
 * 屏幕上从上到下的一行东西。片 b 时这条流里还有一种「跳转记录」—— 片 c0 把它搬进了「互动记录」（D71），
 * 这里只剩老聊天和问答轮次两种。
 */
type Row =
  | { kind: "old"; key: string; role: "user" | "assistant"; text: string }
  | {
      kind: "turn";
      key: string;
      id: string | null;
      tS: number;
      question: string;
      answer: string;
      /** 库里存着的「看了画面」那一版（D75，迁移 0013）。没有 = "" */
      visual: string;
      /** 概述卡（片 c，`interrupts.refs`）。null = 这一轮不是按卡片问的（老数据 / 片 c 之前） */
      refs: AnswerRef[] | null;
      /** 0 = 母问题，1 = 追问（缩进一格 + 细线；读屏另说一声「追问」） */
      depth: 0 | 1;
      /** 片 d 的另一半（D65）：这一问的标签，**原样**（`points[].kinds`，没过 `readKinds`）—— 标签那一格靠它的身份认「变没变」 */
      kinds: unknown;
      /** 正在流式作答 */
      live: boolean;
      error: string;
    };

/**
 * AI 在想的时候是**一个 fermata** —— 三个来回忽浅忽深的点（计划 §B.3）。
 * **不是转圈，不是骨架屏**：转圈说的是"系统在忙"，这里发生的是"它在想"。
 * 呼吸的节律在 `globals.css` 的 `.fermata-dots`（和骨架屏共用一条 keyframe）。
 */
function FermataDots() {
  return (
    <span className="fermata-dots inline-flex items-center gap-1 align-middle" aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
      <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
      <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
    </span>
  );
}

/**
 * 读一条 `/api/ask` 的 NDJSON 流。每收到一块就把**到目前为止的全文**交给 `onPiece`。
 *
 * 抽成函数是因为它有三个调用方：正常问一句、「说短一点」重答一版、「看画面再答」（D75）。
 * 几处逐字复制会漂移 —— 而流式协议这种东西一漂移，症状是"偶尔少最后半句"，
 * 最难查。
 *
 * `on.warn`：答案到了、但服务端有话要说（这一版**没存上** —— D44，答案照给、事情照说）。
 * `on.refs`：概述卡（片 c）。服务端保证它排在 `done` 前面 —— done 带来的全文末尾那几行字要靠它才拆得掉。
 * `on.kinds`：问题分类（片 d 的另一半，D65）。也排在 `done` 前面 —— 答完那一拍标签就跟着这一轮一起进 `points`。
 */
async function streamAsk(
  body: { interruptId: string; question: string; brief?: boolean; look?: boolean; cards?: boolean },
  onPiece: (fullSoFar: string) => void,
  fallbackError: string,
  on?: {
    warn?: (message: string) => void;
    refs?: (refs: AnswerRef[]) => void;
    /** 片 d 的另一半（D65）：这个问题的分类。服务端和卡片一样排在 done 前面推；模型没写那一行就不推 */
    kinds?: (kinds: QuestionKind[]) => void;
  },
): Promise<string> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error ?? fallbackError);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let streamErr = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const raw = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!raw) continue;
      let ev: { type?: string; text?: string; answer?: string; message?: string; refs?: unknown; kinds?: unknown };
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      if (ev.type === "chunk" && ev.text) {
        full += ev.text;
        onPiece(full);
      } else if (ev.type === "refs") {
        on?.refs?.(readRefs(ev.refs) ?? []);
      } else if (ev.type === "kinds") {
        on?.kinds?.(readKinds(ev.kinds) ?? []);
      } else if (ev.type === "done") {
        if (typeof ev.answer === "string") full = ev.answer;
        onPiece(full);
      } else if (ev.type === "error") {
        streamErr = ev.message ?? fallbackError;
      } else if (ev.type === "warn" && ev.message) {
        on?.warn?.(ev.message);
      }
    }
  }
  // 服务端把错误当成流里的一条事件推回来（HTTP 早就 200 了），所以要在这儿抛
  if (streamErr) throw new Error(streamErr);
  if (!full.trim()) throw new Error(fallbackError);
  return full;
}

/**
 * 「看画面中… 5 秒」里那个一直在跑的秒数（D75）。
 * **慢多少没人量过**（本地没 Gemini key，计划「开工先量」第 1 条）—— 让他自己看得见，他点一次就量到了。
 * 自己每秒重画自己，不牵动整栏（问答栏里几十轮问答，别为一个数字每秒全画一遍）。
 */
function Elapsed({ since, render }: { since: number; render: (s: number) => string }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{render(Math.max(0, Math.floor((now - since) / 1000)))}</>;
}

/**
 * 🐞6：`@-13` 的芯片 ——「这一问记在 22:48 · 现在 23:01 往回 13 秒 · 视频不动」。
 *
 * **视频在播的时候数字要跟着走**（他 2026-09-23 拍的：显示的永远是换算好的真实时间，不是「-13」）。
 * 和上面 `Elapsed` 一个路数：**只让芯片自己重画**，不牵动整栏（问答栏里几十轮问答，别为一个数字每秒全画一遍）。
 * 每 250ms 问一次播放器；秒数没变 `setNow` 就不重画（React 对同值的 setState 直接跳过）。
 *
 * `shownRef`：芯片上**此刻显示的「现在」**。发送那一刻按它定死 —— 他按下去时看见 22:48，这一轮就得记在 22:48；
 * 直接再问一次播放器的话，碰上秒数刚好跨过去，那一轮头上会写 22:49，和芯片对不上（验收判据点名要对得上）。
 * 卸载时清空，免得下一句拿到一个过期的数。
 */
function RewindChip({
  back,
  getCurrentTime,
  shownRef,
  render,
}: {
  back: number;
  getCurrentTime: () => number;
  shownRef: React.RefObject<number | null>;
  render: (at: number, now: number, clamped: boolean, back: number) => React.ReactNode;
}) {
  const [now, setNow] = useState(() => Math.max(0, Math.floor(getCurrentTime())));
  useEffect(() => {
    shownRef.current = now;
  }, [now, shownRef]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.max(0, Math.floor(getCurrentTime()))), 250);
    return () => {
      window.clearInterval(id);
      shownRef.current = null;
    };
  }, [getCurrentTime, shownRef]);
  const r = rewindTo(now, back);
  return <>{render(r.at, now, r.clamped, back)}</>;
}

/**
 * 「只记下这一刻」那颗按钮 —— 按下去**先在自己身上**亮出「记着…」，再等 watch-stage 落完点（2026-09-13，INP）。
 *
 * 原来「记着…」这一格挂在 watch-stage 的 state 上：一按就是整页重画（几百行字幕、捕获轴、两个栏），
 * 按钮要等全画完才变字 —— lab 页上点一下 272ms（开发模式）。现在 watch-stage 那边的两句都标成了 transition，
 * 这颗按钮自己记一格「按下去了」，**等的是 `onCapture` 返回的那个 promise**（落库成败都算完）。
 * 不拿「watch-stage 的 busy 亮过没有」来判断什么时候熄：transition 可能被后面的更新合并掉，
 * busy 从头到尾没亮过也是有的 —— 那样按钮就会永远卡在「记着…」。
 */
function CaptureNowButton({
  onCapture,
  capturing,
  label,
  busyLabel,
}: {
  /** 返回 promise 就等它（watch-stage 的 captureOnly 是 async 的）；不返回也行，那就只亮一下 */
  onCapture: () => unknown;
  capturing: boolean;
  label: string;
  busyLabel: string;
}) {
  const [pressed, setPressed] = useState(false);
  const busy = pressed || capturing;
  return (
    <button
      type="button"
      onClick={async () => {
        if (busy) return;
        setPressed(true);
        try {
          await Promise.resolve(onCapture());
        } finally {
          setPressed(false);
        }
      }}
      disabled={busy}
      // `@max-[20rem]:flex-1`：问答栏很窄时输入框独占一排，这颗和「发送」挤在第二排 —— 它让出宽度、字折成两行（片 g3）
      className="min-h-[42px] shrink-0 rounded-xl border border-ink-700 px-2.5 text-xs text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:pointer-events-none disabled:opacity-50 @max-[20rem]:flex-1 @max-[20rem]:shrink"
    >
      {busy ? busyLabel : label}
    </button>
  );
}

export function QaChat({
  hidden,
  points,
  onJump,
  onJumpCard,
  getCurrentTime,
  pauseVideo,
  createPoint,
  onAnswered,
  getPlayTick,
  pinBar,
  focusTurn,
  labelResets,
  peekReset,
  onCaptureNow,
  capturing,
  captureError,
  answerFailedText,
  oldTurns,
  canLook,
  durationS,
  atHintSeen,
  onAtHintSeen,
  tagging,
}: {
  /** 切到别的 tab 了。**不卸载、只 hidden** —— 见下面滚动位置那段 */
  hidden: boolean;
  /** 这条内容所有的捕获点。问过问题的才进聊天流，纯记号只是点点条上一个点（§E.4） */
  points: PausePoint[];
  /**
   * 点一个 `@MM:SS`：就地跳过去（D33 死线：绝不换路由）。
   * **返回牌归 qa-rail 管了**（片 c0：三个栏共用一块，在互动记录里点时间跳走也得看得见）——
   * 它先记下"他现在在哪"、立牌子，再以 `via = at_link` 跳。
   */
  onJump: (t: number) => void;
  /** 点一张概述卡（片 c）：和 `onJump` 一样就地跳 + 立返回牌，只是互动记录里记作「点概述卡」（`via = card`） */
  onJumpCard: (t: number) => void;
  getCurrentTime: () => number;
  pauseVideo: () => void;
  /**
   * 落一个新捕获点，返回真 id（乐观点由调用方画，失败它自己撤）。
   * `pinned` = 这一问用 `@` 指定了时间点（🐞6）—— 记录器据此让这一问和下一问的 `@` 标注都重新算
   */
  createPoint: (tS: number, parentId: string | null, pinned: boolean) => Promise<string>;
  /**
   * 一轮答完，把问题、答案（和片 c 的概述卡、片 d 的分类）回填进那份 `points`（点点条 / 问题列表吃的是同一份）。
   * `kinds` 不传 = 服务端这一趟没推分类（模型没写那一行）
   */
  onAnswered: (id: string, question: string, answer: string, refs: AnswerRef[] | null, kinds?: QuestionKind[]) => void;
  /**
   * 播放器**播起来过几次**。追问的判据（计划 §B.4）写死成
   * 「发送时，距上一轮答完之间播放器**有没有播过**」——
   * 不是"时间差多少秒"。所以这里要的是一个只增不减的计数，不是时间戳。
   */
  getPlayTick: () => number;
  /** D63 钉着的那块返回牌（qa-rail 画好了递进来）—— 在这一栏里它仍然长在输入框上面，和片 b 一模一样 */
  pinBar: React.ReactNode;
  /** 从互动记录点了一个问题过来：滚到那一轮、闪一下（`n` 每点一次 +1，同一条连点两次也要再闪） */
  focusTurn: { id: string; n: number } | null;
  /** 哪几轮之前跳过 —— `@` 标注从那一轮重新算（片 b 的规矩，依据换成了互动记录，D71） */
  labelResets: ReadonlySet<string>;
  /** 现在发出去的这一句算不算"跳过之后"（正在飞、还没落库的那一轮用） */
  peekReset: () => boolean;
  onCaptureNow: () => void;
  capturing: boolean;
  captureError: string;
  /** 兜底报错文案（`stage.answerFailed`）。由 watch-stage 传进来，省一次 `t` 的重复口径 */
  answerFailedText: string;
  /** 老沉浸聊天的逐字记录（D62：老数据不搬家，只读混进来）。null = 还没取到 / 没有 */
  oldTurns: OldTurn[] | null;
  /** 这条内容能不能「看画面再答」（D75：只有 YouTube；播客没有画面，那颗按钮不出现） */
  canLook: boolean;
  /**
   * 内容时长 —— 角标上「看了画面 · 02:45–02:57」的终点要夹在片尾以内（和服务端同一个 `lookClip`）。
   * 片 d 起它还是 `@` 那道闸的尺子：敲一个超出时长的时间要**当场**说不对（计划 §J 第 3 条）。
   */
  durationS: number;
  /** 片 d：`@` 那张单子**自动弹过一次了吗**（存在 `user_settings.atHintSeen`，全站一次，不是每条内容一次） */
  atHintSeen: boolean;
  /** 自动弹的那一次被关掉了 —— 记下来，以后不再自动弹（计划 §J「怎么让用户知道」⒝） */
  onAtHintSeen: () => void;
  /** 片 d 的另一半（D65）：他那句问题下面的标签 —— 显示哪几类、改了怎么存、哪一问没存上（watch-stage 造、两个栏共用） */
  tagging: Tagging;
}) {
  const t = useCopy();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  /** 正在进行的这一轮。落库拿到 id 之前 `id` 是 null（那会儿还不能重试） */
  const [flight, setFlight] = useState<{
    id: string | null;
    tS: number;
    question: string;
    answer: string;
    parentId: string | null;
    error: string;
    /** 发出去那一刻，这一问之前跳过没有（`@` 标注从这儿重新算）—— 还没落库，记录器那份 Set 里还没有它 */
    reset: boolean;
    /** 概述卡（片 c）—— 服务端在 done 之前推过来 */
    refs: AnswerRef[] | null;
  } | null>(null);
  /** 连点都没落上（`createPoint` 就失败了）—— 这时候流里连一行都没有，只能在输入框下面说 */
  const [sendError, setSendError] = useState("");
  /**
   * 答案到了、但**没存上**（片 c 起服务端会说 —— 以前这一步的返回值没人看，写失败了一声不吭，D44）。
   * 按轮次挂在那一轮下面，这一次观看里一直在；那一轮重试成功就撤掉
   */
  const [saveNotes, setSaveNotes] = useState<ReadonlyMap<string, string>>(() => new Map());

  /**
   * D56「说短一点」的短版。**只在内存里** —— 刷新就没，原答案永远是库里那份。
   * key 是 `轮次id:哪一版`（`captions` / `visual`）：D75 之后一轮最多有两版答案，**各有各的短版**，
   * 看画面那版的短版也得带着画面去写（计划：「说短一点」跟着当前显示的那一版走）
   */
  const [briefs, setBriefs] = useState<
    Map<string, { text: string; showing: boolean; busy: boolean; error: string }>
  >(() => new Map());

  /**
   * D75「看画面再答」—— 这一次观看里新要的画面版，按轮次存（库里原有的在 `points[].ai_answer_visual`）。
   * `since`：开始等的时刻（秒数在跑）；`note`：答案到了但**没存上**，要一直挂着说（D44）
   */
  const [looks, setLooks] = useState<
    Map<string, { text: string; busy: boolean; error: string; note: string; since: number }>
  >(() => new Map());
  /** 哪几轮被切回了只看字幕那版 —— 默认有画面版就先显示画面版（他点那颗按钮，就是因为字幕那版不够） */
  const [captionsFirst, setCaptionsFirst] = useState<ReadonlySet<string>>(() => new Set());

  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const keptScrollRef = useRef(0);
  const wasHiddenRef = useRef(hidden);
  /** 上一轮**答完那一刻**播放器的播放次数。追问判据就是拿它和现在比（§B.4） */
  const lastAnswerTickRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * 输入框跟着字长高，到 INPUT_MAX_PX 为止，再多才出滚动条（2026-09-13）。
   *
   * 原来是 `rows=1` 定死一行、滚动条交给浏览器 —— 真机截图里**空着的输入框也冒出一根竖滚动条**：
   * 一行的高度是按「行高 + 内边距」算死的，浏览器一缩放就差出一个像素，被判成溢出。
   * 现在默认 `overflow-hidden`，只有真的长过上限才打开滚动。
   * 用 layout effect：赶在这一帧画出来之前把高度定好，看不见"先跳一下"。每敲一个字量一次，一次不到 1ms。
   */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // ⚠️ **空的时候一律回到最矮那一档，不去量 scrollHeight**（2026-09-19，片 d 量到的）：
    // Blink 下空 textarea 的 `scrollHeight` 把**占位符**也算进去了 —— 片 d 给占位符加了
    // 「（打 @ 可以换个时间点）」，于是右栏一窄，占位符折成两行，**空着的输入框就永远是两行高**，
    // 白吃掉消息流一行的位置（lab 页 1512×900 上量的：42 → 66px）。
    // 空 = 一行，这本来就是对的；顺带把占位符的长短和输入框的高度彻底脱钩。
    if (!el.value) {
      el.style.height = "";
      el.style.overflowY = "hidden";
      return;
    }
    el.style.height = "auto";
    const border = el.offsetHeight - el.clientHeight; // border-box：scrollHeight 里不含上下边框
    const want = el.scrollHeight + border;
    el.style.height = `${Math.min(want, INPUT_MAX_PX)}px`;
    el.style.overflowY = want > INPUT_MAX_PX + 1 ? "auto" : "hidden";
  }, [input]);

  // 已落库、问过问题的轮次，**按落库时间排** ——
  // 不是按 `t_s`：往回拨一段再问一句，那句仍然是"最新的一条"，该排在最下面
  // （计划 §A：「最新的在最下面」）。片 d 的 `@` 指定时间点会更需要这条口径。
  const liveTurns = useMemo(() => {
    return points
      .filter((p) => (p.question ?? "").trim().length > 0)
      .slice()
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }, [points]);

  // ── 片 d：在输入框里打 `@` 指定另一个时间点（计划 §J / D69）──────────────────
  // **判据只有一份**，在 `lib/at-time.ts`（纯函数 + 37 条单元测试）。这一层只管把它接到输入框上。
  /**
   * 这句话读出来：指定了第几秒 + 真正要问的那句 + 写歪了没有。
   * 「现在」只有 `@-13` 用得着 —— 这里算出来的那一秒会随播放过时，所以往回倒的芯片自己跟着播放头重算（`RewindChip`），
   * 发送时也重新读一遍；这里只拿它决定芯片露不露、报不报错
   */
  const at = useMemo(() => readAt(input, durationS, getCurrentTime()), [input, durationS, getCurrentTime]);
  /** 🐞6：往回倒的芯片上**此刻显示的「现在」**（`RewindChip` 写、`send` 读）—— 发送时按它定死，那一轮头上的 `@` 才和芯片对得上 */
  const rewindShownRef = useRef<number | null>(null);
  /** 三种写歪各说各的（D44：说得出是哪一种）。输入框下面那行和发送时拦下来的那句同一个口径 */
  const atErrorText = useCallback(
    (e: NonNullable<AtRead["error"]>) =>
      e === "range" ? t("watch.at.outOfRange", hms(durationS)) : e === "forward" ? t("watch.at.forward") : t("watch.at.badTime"),
    [t, durationS],
  );
  /** 正在打那个时间（`@`、`@12:`…，还没跟空格）—— 单子该浮着。**只看 value 不看按键**（中文输入法，见 at-time.ts 文件头） */
  const typingAt = isTypingAt(input);
  /** Esc / 点到外面：这一段 `@` 先别再弹了（他打的字留着，不替他删） */
  const [atSuppressed, setAtSuppressed] = useState(false);
  /** 自动弹的那一次（第一次问完之后），比上面那种多带一行说明 —— **只此一次**（计划 §J⒝） */
  const [atIntroOpen, setAtIntroOpen] = useState(false);
  /** 这一次挂载里还该不该自动弹。初值 = 库里那个「看过了」 */
  const [atIntroDone, setAtIntroDone] = useState(atHintSeen);

  // 「打完这一段 `@` 就把压制清掉」和「答完第一句自己弹一次」——
  // 都写成**渲染时对一眼**，不写 useEffect 里 setState（本仓库 `react-hooks/set-state-in-effect`
  // 拦过好几次；React 官方给「外部值变了顺手改一个 state」的写法就是这个，qa-rail 的 seenSeekTick 同款）
  const [wasTypingAt, setWasTypingAt] = useState(typingAt);
  if (typingAt !== wasTypingAt) {
    setWasTypingAt(typingAt);
    if (!typingAt && atSuppressed) setAtSuppressed(false);
  }
  // ⚠️ **拿这一次挂载时的轮数当起点**：他上次来已经问过三轮，这次一进门不该迎头弹一张单子出来。
  // 只有「在他眼皮底下又多了一轮」才算「刚问完第一句」
  const [turnsSeen, setTurnsSeen] = useState(liveTurns.length);
  if (liveTurns.length !== turnsSeen) {
    const grew = liveTurns.length > turnsSeen;
    setTurnsSeen(liveTurns.length);
    if (grew && !atIntroDone) {
      setAtIntroDone(true);
      setAtIntroOpen(true);
    }
  }

  const atOpen = (typingAt && !atSuppressed) || atIntroOpen;
  /**
   * 关掉单子。**自动弹的那一次被关掉 = 以后不再自动弹**（落进 `user_settings`，计划 §J⒝）——
   * 写在这儿不写在渲染里：那是一次网络请求，渲染里不许有副作用
   */
  const closeAt = useCallback(() => {
    if (atIntroOpen) {
      setAtIntroOpen(false);
      onAtHintSeen();
    }
    setAtSuppressed(true);
  }, [atIntroOpen, onAtHintSeen]);

  /** 写歪了那句话**打字打到一半不说** —— `@12:` 还没敲完就红一下是在骂人。跟上空格、算是写完了，才说 */
  const atError = typingAt ? null : at.error;

  /**
   * 单子里都有谁：**和问题列表同一份 `points`**（计划 §J 第 1 条：不另存一份）。
   * 单子开着才算 —— 关着的时候 `points` 一变就白算一遍（这一栏每收到一块答案都重画）
   */
  const atList = useMemo(() => (atOpen ? atEntries(points, getCurrentTime()) : []), [atOpen, points, getCurrentTime]);

  // 一条流里的所有行：老聊天在最前（只读），然后问答轮次按落库时间排（liveTurns 已经排好了）。
  // 跳转记录不在这条流里了 —— 片 c0 搬进了「互动记录」（D71）
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    (oldTurns ?? []).forEach((o, i) => {
      if (!o.text?.trim()) return;
      out.push({ kind: "old", key: `old-${i}`, role: o.role, text: o.text });
    });

    for (const p of liveTurns) {
      out.push({
        kind: "turn",
        key: p.id,
        id: p.id,
        tS: p.t_s,
        question: p.question ?? "",
        answer: p.ai_answer ?? "",
        visual: p.ai_answer_visual ?? "",
        refs: readRefs(p.refs),
        depth: p.parent_id ? 1 : 0,
        kinds: p.kinds ?? null,
        live: false,
        error: "",
      });
    }

    // 正在问的那一轮永远在最下面（它还没落库，也就还没有 created_at）
    if (flight) {
      out.push({
        kind: "turn",
        key: "flight",
        id: flight.id,
        tS: flight.tS,
        question: flight.question,
        answer: flight.answer,
        visual: "",
        refs: flight.refs,
        depth: flight.parentId ? 1 : 0,
        // 正在问的这一轮还没有标签：答完那一拍它进了 `points`，才以落好的那一轮的身份带着标签出现
        kinds: null,
        live: !flight.error,
        error: flight.error,
      });
    }
    return out;
  }, [oldTurns, liveTurns, flight]);

  /**
   * 哪几行要标 `@MM:SS`。**连着几轮挨得近就不重复标**（计划 §B.2）——
   * 每 8 秒问一句的人不该看见一柱子长得一样的时间戳。
   * 跳转之后**重新开始算**：他刚被送到别处，那一刻的时间戳是有信息量的。
   * 片 c0 起「有没有跳过」的依据是**互动记录**：两问之间 `watch_events` 里有没有一次跳转（D71）——
   * 不再只认问答里那个 `@`，播放器上、捕获轴、字幕、±N 的跳转都算。
   */
  const flightReset = flight?.reset ?? false;
  const labelled = useMemo(() => {
    const show = new Set<string>();
    let lastShown: number | null = null;
    for (const r of rows) {
      if (r.kind !== "turn") continue;
      const reset = r.key === "flight" ? flightReset : r.id !== null && labelResets.has(r.id);
      if (reset) lastShown = null;
      if (lastShown === null || Math.abs(r.tS - lastShown) >= REPEAT_LABEL_GAP_S) {
        show.add(r.key);
        lastShown = r.tS;
      }
    }
    return show;
  }, [rows, labelResets, flightReset]);

  // ── 滚动 ──
  // 停在底部就跟最新；用户上滑看历史则不抢（和沉浸聊天同一条规矩）。
  // `briefs` / `looks` 也算「最新」：短版、看画面那版是在原地流出来的，`rows` 不变 ——
  // 不跟的话，点完「看画面再答」那颗按钮换成「看画面中… 3 秒」、折到下一行，就掉出视野了（2026-09-18 lab 页上撞到）
  useEffect(() => {
    if (hidden) return; // 藏着的时候 scrollHeight 是 0，这会儿写 scrollTop 等于把它清零
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows, briefs, looks, atBottom, hidden]);

  /**
   * 片 c0：从互动记录点了一个问题过来 —— 滚到那一轮、闪一下（D71：**不动视频**）。
   * 排在上面那个"跟到最新"的 effect **后面**：两个同时跑时，这一下要最后说了算。
   * 不用 `scrollIntoView`：它会顺带去滚所有能滚的祖先（包括整页那个 `overflow-hidden` 的根），
   * 页面会被悄悄挪走。只改这一栏自己的 `scrollTop`。
   */
  useEffect(() => {
    if (!focusTurn || hidden) return;
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-turn-id="${focusTurn.id}"]`);
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    box.scrollTop += r.top - b.top - Math.max(0, (box.clientHeight - r.height) / 2);
    el.classList.remove("qa-flash");
    void el.offsetWidth; // 重启动画：同一条连点两次也要再闪一次
    el.classList.add("qa-flash");
    const timer = window.setTimeout(() => el.classList.remove("qa-flash"), 1600);
    return () => window.clearTimeout(timer);
  }, [focusTurn, hidden]);

  /**
   * 切走 / 切回来时**自己记自己的滚动位置**（片 a 定的规矩，这一栏也照办）。
   *
   * ⚠️ 这一栏和另外两栏**不共用那个滚动容器** —— 它底下钉着输入框和返回牌，
   * 只有消息流该滚。所以片 a 那份 `scrollRef` 记不到它，得在这儿自己记。
   * 用 `useLayoutEffect`：要赶在这一帧画出来**之前**还原，否则看得见"先跳到顶再弹回去"。
   *
   * ⚠️⚠️ **位置是在 `onScroll` 里一路记着的，不是切走那一刻才去读的**（2026-09-09 实测踩到）。
   * 我第一版写的是"effect 里发现 hidden 变成 true 就读一下 `scrollTop`" —— 读到的**永远是 0**：
   * layout effect 跑在 DOM 更新**之后**，那时元素已经是 `display:none`，
   * 浏览器早就把 `scrollTop` 抹平了。实测：滚到 4321 → 切走 → 切回来 = **0**。
   * （片 a 那两栏没这个毛病，因为它在 `switchTo` 里、DOM 变之前就读了。）
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!hidden && wasHiddenRef.current) {
      el.scrollTop = atBottomRef.current ? el.scrollHeight : keptScrollRef.current;
    }
    wasHiddenRef.current = hidden;
  }, [hidden]);

  /**
   * 片 g：这一栏**自己变高变矮**时（换布局 ——「沉浸 · 窄」里它一路竖到屏幕底；或者输入框多长了一行），
   * 本来停在最底下的就继续贴着底。上面那个「跟到最新」只在有新内容时跑，光是框变了它不知道 ——
   * 从高切回矮，最新那一轮就会掉到框外面去。藏着的时候（切到别的 tab）高度是 0，不碰它
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight > 0 && atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // 一路记着，别等切走那一刻才读 —— 那时候它已经是 0 了（见上面那段）
    keptScrollRef.current = el.scrollTop;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
  };

  // （片 b 在这儿的「用户自己动了播放头就撤掉钉着那条」—— 片 c0 随返回牌一起搬去了 qa-rail.tsx）

  /** 点一个 `@MM:SS`：跳过去 + 立返回牌（都交给 qa-rail）。这一栏自己跟到最新 */
  const jumpTo = useCallback(
    (toS: number) => {
      onJump(toS);

      setAtBottom(true);
    },
    [onJump],
  );

  /** 点一张概述卡（片 c）：和 `@` 同一个脾气 —— 跳过去、立返回牌、这一栏跟到最新；只是 via 记作 `card` */
  const jumpToCard = useCallback(
    (toS: number) => {
      onJumpCard(toS);
      setAtBottom(true);
    },
    [onJumpCard],
  );

  /** 真正把一句话发出去。`retryId` 有值 = 这一轮的点早就落好了，别再落一个 */
  const send = useCallback(
    async (raw: string, retryId?: string) => {
      // 片 d：行首那个 `@12:34` 是**指定时间点**，不是问题的一部分。
      // ⚠️ 重试那一路不解析：那一轮的点早就落好了，而库里存的问句本来就已经摘干净了
      // 🐞6：`@-13` 的「现在」按**芯片上正显示的那一秒**定死（他按下去时看见的是 22:48，就记 22:48）。
      // 只有它和播放器差出 1 秒以上才不信它 —— 那是芯片过期了（比如标签页在后台时计时器被限速），这时候以播放器为准
      const fresh = Math.max(0, Math.floor(getCurrentTime()));
      const shown = rewindShownRef.current;
      const nowS = shown !== null && Math.abs(shown - fresh) <= 1 ? shown : fresh;
      const read = retryId ? notPinned(raw) : readAt(raw, durationS, nowS);
      // D44：写歪了**当场说**，不许闷着按当前播放头算 —— 那会把问题记到错的一秒上，而且谁都看不出来
      if (read.error) {
        setSendError(atErrorText(read.error));
        return;
      }
      const question = read.question;
      if (!question || sending) return;
      pauseVideo(); // 提问必先暂停（D33 的老规矩，计划 §B.1）。**指定了时间点也照暂停** —— 暂停不等于跳走
      setSendError("");
      setSending(true);
      setAtBottom(true);

      let id = retryId ?? null;
      let parentId: string | null = null;

      if (!retryId) {
        setInput("");
        // 往下取整（片 b 是四舍五入）：播放器的时钟、互动记录里的「停在 02:03」都是往下取整的，
        // 四舍五入会让紧跟着的那一问写成「@02:04」—— 片 c0 的 lab 页上并排出现过，看着像又跳了一秒
        // 片 d：指定了就记在那一秒（**视频不动** —— 他是在回头问那一段，不是要跳过去看，计划 §J）。
        // 服务端拿这一秒算上下文窗口 `[t−15s, t+3s]`（`/api/interrupts` 里那两条 D5 的常数），
        // 所以喂给 AI 的字幕**自己就搬过去了**，这条路上一行特殊代码都不用写
        const tS = read.at ?? Math.max(0, Math.floor(getCurrentTime()));
        // ── 追问判据（计划 §B.4）：**上一轮答完之后播放器有没有播过** ──
        // 写死成"有没有播过"而不是"隔了几秒"是创始人定的口径：
        // 盯着答案读了两分钟再追问，那仍然是追问；看了十秒视频再问，那是新问题。
        // 顺带白捡「他问了几个回合才接着看」这份数据 —— 就是一串子问题的长度，不另埋点。
        const last = liveTurns[liveTurns.length - 1];
        // **指定了别处的时间点就不算追问**（片 d 的偏离，写进了交付日志）：追问缩进说的是
        // 「顺着刚才那一问接着问」，而他刚把话头挪到 12:34 —— 挂在上一问下面会把两件事说成一件
        const followUp = read.at === null && last && lastAnswerTickRef.current === getPlayTick();
        // 追问的追问仍然挂在**同一个母问题**下面 —— 只缩一格，不无限往右退
        parentId = followUp ? (last.parent_id ?? last.id) : null;
        // 🐞6：**指定了时间点的这一轮，头上的 `@` 一定要露出来** —— 他指定的就是那一秒（「发送完就是显示的是…真实时间」）。
        // 不然 `@-13` 离上一轮只差 13 秒，会被「30 秒内不重复标」那条规矩（§B.2）吞掉，他根本看不见 22:48。
        // 记录器那边也记一笔（`pinned`），下一问因此也重新标 —— 否则紧跟着在播放头上问的那句会看起来也在 22:48
        const pinned = read.at !== null;
        setFlight({ id: null, tS, question, answer: "", parentId, error: "", reset: pinned || peekReset(), refs: null });
        try {
          id = await createPoint(tS, parentId, pinned);
        } catch (e) {
          // 连点都没落上：这一轮**根本没发生过**，流里不该留一条半截的。
          //
          // ⚠️ **把他打的那句话放回输入框**（2026-09-09 实测补的）：
          // 上面 `setInput("")` 已经清空了，不还回去的话，他写的那句就这么没了 ——
          // 报错说得再清楚，让人重打一遍也还是把 D44 的「给一条人点得动的重试」丢了。
          // **还原成他打的那一句原样**（含行首的 `@12:34`）—— 只还问题不还时间，等于让他重挑一次
          setInput(raw);
          setFlight(null);
          setSendError(e instanceof Error ? e.message : answerFailedText);
          setSending(false);
          return;
        }
        setFlight((f) => (f ? { ...f, id } : f));
      } else {
        setFlight((f) => (f ? { ...f, answer: "", error: "", refs: null } : f));
      }

      // 回调里收到的东西先放在这儿（不用 `let`：TS 看不见回调里的赋值，会把它当成永远是初值）
      const got: { refs: AnswerRef[] | null; note: string; kinds?: QuestionKind[] } = { refs: null, note: "" };
      try {
        // `cards`：「视频别处还讲到」要成概述卡（片 c）—— 服务端核对原句、在 done 之前把卡片推过来
        const full = await streamAsk(
          { interruptId: id!, question, cards: true },
          (soFar) => {
            setFlight((f) => (f ? { ...f, answer: soFar } : f));
          },
          answerFailedText,
          {
            refs: (refs) => {
              got.refs = refs;
              setFlight((f) => (f ? { ...f, refs } : f));
            },
            warn: (message) => {
              got.note = message;
            },
            kinds: (kinds) => {
              got.kinds = kinds;
            },
          },
        );
        // 答完了：交给上面那份 points（点点条 / 问题列表吃同一份），本地这条就退场
        lastAnswerTickRef.current = getPlayTick();
        // 没存上就一直挂在这一轮下面说（D44）；这一轮重试存上了就撤掉
        setSaveNotes((m) => {
          if (!got.note && !m.has(id!)) return m;
          const next = new Map(m);
          if (got.note) next.set(id!, got.note);
          else next.delete(id!);
          return next;
        });
        onAnswered(id!, question, full, got.refs, got.kinds);
        setFlight(null);
      } catch (e) {
        // ⚠️ **点留着，问题文字只活在这一次观看里**：`/api/ask` 一直是"答完整才落库"
        // （半截答案不落库，别坑复习）。所以这儿要么重试、要么这句话就没了 ——
        // 界面上必须把这件事说出来，不许假装没事（D44）。
        setFlight((f) => (f ? { ...f, error: e instanceof Error ? e.message : answerFailedText } : f));
      }
      setSending(false);
    },
    [
      sending,
      pauseVideo,
      getCurrentTime,
      getPlayTick,
      liveTurns,
      createPoint,
      onAnswered,
      answerFailedText,
      peekReset,
      durationS,
      atErrorText,
    ],
  );

  /**
   * D56「说短一点」。三件事一起才算做对：
   * ① 原答案**不覆盖**（服务端那趟带 `brief` 就不写库）；
   * ② 两版**可来回切**（拿到过就只是切显示，不再花钱）；
   * ③ **不点就一分钱不花**（D44）。
   */
  const toggleBrief = useCallback(
    async (id: string, question: string, basis: "captions" | "visual") => {
      const key = `${id}:${basis}`;
      const have = briefs.get(key);
      if (have?.busy) return;
      if (have && have.text) {
        setBriefs((m) => new Map(m).set(key, { ...have, showing: !have.showing, error: "" }));
        return;
      }
      setBriefs((m) => new Map(m).set(key, { text: "", showing: true, busy: true, error: "" }));
      try {
        // 看画面那版的短版也带着画面去写（D75）—— 否则「短版」说的就不是屏幕上那件事了
        const full = await streamAsk(
          { interruptId: id, question, brief: true, look: basis === "visual" || undefined },
          (soFar) => {
            setBriefs((m) => {
              const cur = m.get(key);
              return new Map(m).set(key, {
                text: soFar,
                showing: true,
                busy: true,
                error: cur?.error ?? "",
              });
            });
          },
          answerFailedText,
        );
        setBriefs((m) => new Map(m).set(key, { text: full, showing: true, busy: false, error: "" }));
      } catch {
        // 说不出是哪一种失败也要说"失败了"，并且**留一条人点得动的重试**（D44）
        setBriefs((m) =>
          new Map(m).set(key, { text: "", showing: false, busy: false, error: t("watch.qa.shorterFailed") }),
        );
      }
    },
    [briefs, answerFailedText, t],
  );

  /**
   * D75「看画面再答」。三件事一起才算做对（和 D56 同一个脾气，只多了「存库」）：
   * ① **只看字幕那版原地不动**（服务端只写 `ai_answer_visual`）；
   * ② 两版**可来回切**，切换不再花钱（`captionsFirst` 只是换显示）；
   * ③ **不点就一分钱不花**；点了之后秒数在跑，他看得见在等什么。
   * 看砸了：说清楚是哪一种（看不了这支视频 / 别的），那颗按钮还在 —— 人点得动的重试（D44）。
   */
  const lookAgain = useCallback(
    async (id: string, question: string) => {
      if (looks.get(id)?.busy) return;
      setLooks((m) => new Map(m).set(id, { text: "", busy: true, error: "", note: "", since: Date.now() }));
      // 他刚点了要看画面 —— 画面版一到就显示它，哪怕他之前把这一轮切回过只看字幕
      setCaptionsFirst((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      let note = "";
      try {
        // `cards`：这一趟不写「别处还讲到」（卡片已经挂在只看字幕那版上），万一写了服务端也挡在流外面（片 c）
        const full = await streamAsk(
          { interruptId: id, question, look: true, cards: true },
          (soFar) => {
            setLooks((m) => {
              const cur = m.get(id);
              return new Map(m).set(id, { text: soFar, busy: true, error: "", note: "", since: cur?.since ?? Date.now() });
            });
          },
          t("watch.qa.lookFailed"),
          {
            warn: (w) => {
              note = w;
            },
          },
        );
        setLooks((m) => new Map(m).set(id, { text: full, busy: false, error: "", note, since: 0 }));
      } catch (e) {
        setLooks((m) =>
          new Map(m).set(id, {
            text: "",
            busy: false,
            error: e instanceof Error && e.message ? e.message : t("watch.qa.lookFailed"),
            note: "",
            since: 0,
          }),
        );
      }
    },
    [looks, t],
  );

  /** 在两版之间切 —— **只换显示，不花钱**（D75） */
  const flipBasis = useCallback((id: string) => {
    setCaptionsFirst((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 三连只挂在**最后一轮**上（计划 §B.6：推力加在"看完答案那一刻"）。
  // 每一轮都挂三颗按钮，右栏会变成一面按钮墙 —— 那是噪音，不是推力。
  const lastAnsweredId = flight ? null : (liveTurns[liveTurns.length - 1]?.id ?? null);

  return (
    <div
      role="tabpanel"
      id="qa-rail-panel-chat"
      aria-labelledby="qa-tab-chat"
      hidden={hidden}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* ── 消息流 ──
           上下留白放在里面那一层（2026-09-23，🐞6 量到的）：写在滚动层自己身上时，那 24px 是它**缩不下去的底**。
           1280×680 上这一栏本来就只剩 24px，输入框上面再多一行（`@-13` 的芯片折成两行），「发送」就被顶出屏幕 7px。
           挪进来之后滚动层能缩到 0 —— 挤不下的时候让消息流让位，**「发送」永远看得见**；平时长相一个像素不变 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // 片 g3：这一栏里的字号**全按 `--chat-fs` 走**（tab 那一行右边的「字体 − +」，见 qa-rail 的 ChatTextSize）。
        // 里面每一处都写成 em（相对这一层），比例照抄原来的 Tailwind 类（按 14px 算：text-sm = 1em、text-xs = 0.8571em……），
        // 所以字号一变，角标、卡片、按钮一起按比例缩放，谁也不会突然比别人大一截
        className="min-h-0 flex-1 overflow-y-auto px-3 text-[length:var(--chat-fs,15px)]"
      >
        <div className="py-3">
          {rows.length === 0 && (
            <p className="text-[1em] leading-[1.7143] text-ink-500">{t("watch.rail.empty.chat")}</p>
          )}

          {rows.map((r, i) => {
            if (r.kind === "old") {
              const first = rows[i - 1]?.kind !== "old";
              return (
                <div key={r.key}>
                  {/* 老记录只在**第一条**头上说一次来历，别每条都挂一顶帽子 */}
                  {first && (
                    <div className="mb-2 border-b border-ink-700 pb-1.5">
                      <p className="text-[0.8571em] font-semibold text-ink-300">{t("watch.qa.oldTitle")}</p>
                      <p className="mt-0.5 text-[0.8em] leading-[1.4286] text-ink-500">{t("watch.qa.oldHint")}</p>
                    </div>
                  )}
                  {/* 老记录也照新规矩：提问装进气泡、回答不套框，只是整体淡一档 = 只读 */}
                  {r.role === "user" ? (
                    <div className="mt-3 flex justify-end pl-8 opacity-60">
                      <p className={BUBBLE}>{r.text}</p>
                    </div>
                  ) : (
                    <div className="mt-1.5 opacity-60">
                      {toSegments(r.text).map((s, j) => (
                        <p key={j} className="font-chat text-[1em] leading-[1.7143] text-ink-300">
                          {s}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            // D75：看了画面那一版 —— 这一次刚要的（正在流也算）优先，其次是库里存着的
            const look = r.id ? looks.get(r.id) : undefined;
            const lookBusy = Boolean(look?.busy);
            const visual = look?.text || r.visual;
            const basis: "captions" | "visual" = visual && !(r.id && captionsFirst.has(r.id)) ? "visual" : "captions";
            const brief = r.id ? briefs.get(`${r.id}:${basis}`) : undefined;
            const showingBrief = Boolean(brief?.showing && (brief.text || brief.busy));
            // 片 c：全文末尾那几行「05:12 · … “…”」是给历史页的文字版，这里拆掉、换成卡片
            const split = splitAnswer(r.answer, r.refs);
            const body = showingBrief ? (brief?.text ?? "") : basis === "visual" ? visual : split.body;
            const saveNote = r.id ? saveNotes.get(r.id) : undefined;
            const isLast = r.id !== null && r.id === lastAnsweredId;
            // 角标上写的那一段，和服务端喂给模型的是同一个函数算的（lib/look.ts）
            const clip = lookClip(r.tS, durationS);

            return (
              <div
                key={r.key}
                // 互动记录里点一个问题，要靠它找到这一轮（片 c0）
                data-turn-id={r.id ?? undefined}
                // 追问缩进一格 + 一条细线，看一眼就知道它挂在上面那句下面（片 b 的样子）。
                // 2026-09-13 修补轮拿掉过（D72），2026-09-18 创始人看了前后截图：「问答栏也缩进」+「线再亮一点」——
                // 线从片 b 的 ink-700 提到 ink-500（调色板里紧挨着的那一档）。
                // D72 平铺的只有互动记录里「只看提问」那张列表，**别再把那一条推到这一栏**
                className={`${i === 0 ? "" : "mt-5"} ${r.depth === 1 ? "border-l border-ink-500 pl-3" : ""}`}
              >
                {r.depth === 1 && (
                  <span className="sr-only">{t("watch.qa.followUpAria")}</span>
                )}

                {/* `@MM:SS` —— 点它就地跳过去（D33 死线：绝不换路由） */}
                {labelled.has(r.key) && (
                  <button
                    type="button"
                    onClick={() => jumpTo(r.tS)}
                    aria-label={t("watch.qa.jumpTo", mmss(r.tS))}
                    className="ui-mono mb-1 rounded px-1 py-0.5 text-[0.8em] text-teal-300 transition-colors hover:bg-ink-700 hover:text-teal-100"
                  >
                    @{mmss(r.tS)}
                  </button>
                )}

                {/* 提问 = 靠右的一个气泡；回答不套框（见上面 BUBBLE 那段）。
                    2026-08-01 创始人真机反馈：全贴左边分不清谁说的 → 靠右；2026-09-13：再装进气泡 */}
                <div className="flex justify-end pl-8">
                  <p className={BUBBLE}>{r.question}</p>
                </div>

                {/* 片 d 的另一半（D65）：这一问的标签，挂在他那句问题下面、靠右 —— **答完那一拍出现**（正在问的那一行没有）。
                    小、灰，不抢答案的戏；点一下展开成开关，当场存（`kind-tags.tsx`）。字号按这一栏的 em 走（「− 字体 +」一起缩放） */}
                {r.id && r.key !== "flight" && (
                  <div className="mt-1 flex justify-end pl-8">
                    <KindTags
                      kinds={r.kinds}
                      showLanguage={tagging.showLanguage}
                      onChange={(next) => tagging.onSet(r.id!, next)}
                      error={tagging.errors.get(r.id)}
                      className="text-[0.7086em] leading-[1.45]"
                    />
                  </div>
                )}

                <div className="mt-2">
                  {r.error ? (
                    <div role="alert">
                      <p className="text-[0.8571em] leading-[1.6667] text-amber-300/90">{r.error}</p>
                      {r.id && (
                        <button
                          type="button"
                          onClick={() => void send(r.question, r.id!)}
                          disabled={sending}
                          className="mt-1 h-8 rounded-lg border border-ink-700 px-2.5 text-[0.8571em] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                        >
                          {t("watch.qa.retry")}
                        </button>
                      )}
                    </div>
                  ) : body ? (
                    <>
                      {/* 角标一行：这一版的依据（D75：看了画面 · 哪一段 / 只看了字幕）+ 短版 + 两版之间切换（不花钱）。
                          只有这一轮真有两版时才出现 —— 没点过看画面的轮次和以前一模一样 */}
                      {(visual || showingBrief) && (
                        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {visual ? (
                            <span className={TAG}>
                              {basis === "visual"
                                ? t("watch.qa.lookTag", mmss(clip.fromS), mmss(clip.toS))
                                : t("watch.qa.captionsTag")}
                            </span>
                          ) : null}
                          {showingBrief && <span className={TAG}>{t("watch.qa.shorterTag")}</span>}
                          {visual && r.answer && r.id && !lookBusy ? (
                            <button
                              type="button"
                              onClick={() => flipBasis(r.id!)}
                              className="rounded px-1 py-0.5 text-[0.7086em] text-ink-300 underline decoration-ink-500 underline-offset-2 transition-colors hover:text-teal-300"
                            >
                              {basis === "visual" ? t("watch.qa.lookShowCaptions") : t("watch.qa.lookShowVisual")}
                            </button>
                          ) : null}
                        </div>
                      )}
                      {toSegments(body).map((s, j) => (
                        <p key={j} className="font-chat text-[1em] leading-[1.7143] text-ink-100">
                          {s}
                        </p>
                      ))}
                      {(r.live || brief?.busy || (basis === "visual" && lookBusy)) && <FermataDots />}
                      {/* 片 c 概述卡：跟着这一轮走，两版答案下面都挂；短版下面不挂（短版本来就不写这一段） */}
                      {!showingBrief && <RefCards refs={split.refs} fromS={r.tS} onJump={jumpToCard} />}
                    </>
                  ) : (
                    <p className="flex items-center gap-2">
                      <FermataDots />
                      <span className="sr-only" role="status">
                        {t("watch.qa.thinking")}
                      </span>
                    </p>
                  )}
                </div>

                {/* D75：看画面那一趟的下落，跟着**这一轮**走（不跟着最后一轮那排按钮）——
                    看砸了说是哪一种；答案到了但没存上，这一次观看里一直挂着说（D44） */}
                {look?.error ? (
                  <p role="alert" className="mt-1.5 text-[0.8em] leading-[1.4286] text-amber-300/90">
                    {look.error}
                  </p>
                ) : null}
                {look?.note ? (
                  <p role="status" className="mt-1.5 text-[0.8em] leading-[1.4286] text-amber-300/90">
                    {look.note}
                  </p>
                ) : null}
                {/* 这一轮的回答没存上（片 c 起服务端会说，D44）—— 和上面那句同一个样子 */}
                {saveNote ? (
                  <p role="status" className="mt-1.5 text-[0.8em] leading-[1.4286] text-amber-300/90">
                    {saveNote}
                  </p>
                ) : null}

                {/* ── 答完之后的三连（计划 §B.6 + D56）──
                    为什么在**答案之后**而不是提问之前：人默认问浅问题，
                    推力要加在看完答案那一刻。只挂最后一轮，见上面 lastAnsweredId */}
                {isLast && !r.error && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void send(t("watch.qa.whyQ"))}
                      disabled={sending}
                      className="h-8 rounded-full border border-ink-700 px-3 text-[0.8571em] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                    >
                      {t("watch.qa.why")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void send(t("watch.qa.relationQ"))}
                      disabled={sending}
                      className="h-8 rounded-full border border-ink-700 px-3 text-[0.8571em] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                    >
                      {t("watch.qa.relation")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleBrief(r.id!, r.question, basis)}
                      // 看画面那一趟还在流的时候先别写短版：那会儿显示的是哪一版还没定
                      disabled={Boolean(brief?.busy) || lookBusy}
                      className="h-8 rounded-full border border-ink-700 px-3 text-[0.8571em] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                    >
                      {brief?.busy
                        ? t("watch.qa.shorterGoing")
                        : showingBrief
                          ? t("watch.qa.shorterBack")
                          : t("watch.qa.shorter")}
                    </button>
                    {/* D75「看画面再答」：只在 YouTube；这一轮已经有画面版了就不再摆（切换在角标那一行，不花钱）。
                        等的时候秒数在跑 —— 慢多少没人量过，让他自己看得见 */}
                    {canLook && (lookBusy || !visual) && (
                      <button
                        type="button"
                        onClick={() => void lookAgain(r.id!, r.question)}
                        disabled={lookBusy}
                        title={t("watch.qa.lookTitle")}
                        className="h-8 rounded-full border border-ink-700 px-3 text-[0.8571em] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                      >
                        {lookBusy && look ? (
                          <Elapsed since={look.since} render={(s) => t("watch.qa.lookGoing", s)} />
                        ) : (
                          t("watch.qa.look")
                        )}
                      </button>
                    )}
                    {brief?.error && (
                      <p role="alert" className="w-full text-[0.8em] leading-[1.4286] text-amber-300/90">
                        {brief.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 「回到最新」：上滑看历史时才出现，点了才回底 */}
      {!atBottom && rows.length > 0 && (
        <div className="px-3">
          <button
            type="button"
            onClick={() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
              atBottomRef.current = true;
              setAtBottom(true);
            }}
            className="mb-1 h-7 w-full rounded-lg bg-ink-700/70 text-xs text-ink-300 transition-colors hover:text-teal-300"
          >
            {t("watch.qa.toLatest")}
          </button>
        </div>
      )}

      {/* ── D63 钉在这儿那条：**动作**，一键回去，不用滚。片 c0 起由 qa-rail 画好递进来（三个栏共用一块）── */}
      {pinBar}

      {/* ── 输入条 ── */}
      {/* `relative`：片 d 那张单子是**贴着这一条往上浮**的（`bottom-full`），锚点就是它 */}
      <div className="relative shrink-0 border-t border-ink-700 px-2 py-2">
        {/* ── 片 d：打 `@` 浮出来的那张单子（计划 §J / D69）。
             **贴着输入条往上浮**（绝对定位，锚点是外面这一层 `relative`）—— 三版才量对，为什么在 `at-picker.tsx` 里写着。
             它一个 seek 都不发 —— `@` 只问不动，要动是点点条的事（创始人自己定的分工）── */}
      {atOpen && (
        <AtPicker
          entries={atList}
          nowS={getCurrentTime()}
          intro={atIntroOpen}
          onPick={(label) => {
            setInput((v) => withAt(v, label));
            if (atIntroOpen) {
              setAtIntroOpen(false);
              onAtHintSeen();
            }
            inputRef.current?.focus();
          }}
          onNow={() => {
            setInput((v) => withoutAt(v));
            if (atIntroOpen) {
              setAtIntroOpen(false);
              onAtHintSeen();
            }
            inputRef.current?.focus();
          }}
          onClose={closeAt}
          anchorRef={inputRef}
        />
      )}

        {/* 一行三样：输入框 · 「只记下这一刻」 · 发送。
            **它们在同一行是量出来的，不是排版偏好**：1512×859 上这一栏总共只有 269px，
            把捕获按钮单摆一行，能滚的消息流只剩 133px（≈5 行字）。并进这一行之后是 167px。
            §F 原话本来就是「输入框**边上**一颗小按钮」—— 同一行才是它说的那个位置。 */}

        {/* 片 d：指定好了就挂一枚芯片 —— **看得见才算数**。
            那半句「视频不动」不是废话：他刚挑了 12:34 而画面停在 25:03，不说一声他会以为没生效。
            🐞6：`@-13` 的芯片写**换算好的那一秒**，并且跟着播放头走（`RewindChip`）；倒过片头就写「到片头了」。
            `flex-wrap`：往回倒那句说明长一截，右栏窄的时候折到第二行，不许把这一栏撑出横向滚动条 */}
        {at.at !== null && !typingAt && (
          <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {at.back !== null ? (
              <RewindChip
                back={at.back}
                getCurrentTime={getCurrentTime}
                shownRef={rewindShownRef}
                render={(atS, nowS, clamped, back) => (
                  <>
                    <span className="ui-mono inline-flex items-center gap-1 rounded-lg bg-teal-400/15 px-2 py-0.5 text-[0.66rem] text-teal-300">
                      {t("watch.at.chip", mmss(atS))}
                    </span>
                    <span className="text-[0.62rem] text-ink-500">
                      {clamped ? t("watch.at.rewindClamped", mmss(nowS), back) : t("watch.at.rewindHint", mmss(nowS), back)}
                    </span>
                  </>
                )}
              />
            ) : (
              <>
                <span className="ui-mono inline-flex items-center gap-1 rounded-lg bg-teal-400/15 px-2 py-0.5 text-[0.66rem] text-teal-300">
                  {t("watch.at.chip", mmss(at.at))}
                </span>
                <span className="text-[0.62rem] text-ink-500">{t("watch.at.chipHint")}</span>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setInput((v) => withoutAt(v));
                inputRef.current?.focus();
              }}
              aria-label={t("watch.at.clear")}
              className="flex h-5 w-5 items-center justify-center rounded text-ink-500 transition-colors hover:bg-ink-700 hover:text-ink-100"
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
        )}

        {/* 片 g3：中缝在每种布局里都能拖了，右栏能窄到 183px（1024 宽、拖到 78%）—— 英文那一排
            「输入框 + Just mark this moment + Send」要 313px 才放得下，**Send 被切掉半截**（lab 页量到的；① 拖到头本来就这样，只是以前少有人拖）。
            这一栏窄于 20rem 时折成两排：输入框占满第一排，两颗按钮在第二排（「只记下这一刻」让出宽度、字折行）。宽的时候一个像素不变 */}
        <div className="flex flex-wrap items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter 发送、Shift+Enter 换行。
              // ⚠️ `isComposing` 必须拦：中文输入法选词时按的那个 Enter 是**上屏**，
              // 不是发送 —— 不拦的话中文用户每打一个词就发出去一句半截的话。
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
              // 片 d：Esc 收起那张单子。**他打的字一个不动** —— 替用户删字是最招人恨的一种"贴心"
              if (e.key === "Escape" && atOpen) {
                e.preventDefault();
                closeAt();
              }
            }}
            rows={1}
            placeholder={t("watch.qa.placeholder")}
            // 高度由上面那个 layout effect 按字数撑（到 INPUT_MAX_PX 为止）；`overflow-hidden` 是默认，长过上限才打开滚动
            // `placeholder:truncate`（片 g2）：栏窄时占位符折成两三行，第二行的上半截从框的下内边距里露出来（1280 宽的 ① 上量到：
            // 框 40px 高、占位符 88px）。一行放不下就省略号收住。框只有一行高是片 d 定的（占位符不许把空输入框撑成两行）
            className="max-h-24 min-h-[42px] min-w-0 flex-1 resize-none overflow-hidden rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm leading-6 text-ink-100 placeholder:truncate placeholder:text-ink-500 focus:border-teal-400 focus:outline-none @max-[20rem]:basis-full"
          />
          {/* 「只记下这一刻」**搬到输入框边上了**（片 a 把它临时摆在空态里，§F 说的家就是这儿）。
              它是悬浮球在宽屏上的替身：先记下来，待会儿再问 —— 记完点点条上当场多一个点。 */}
          <CaptureNowButton
            onCapture={onCaptureNow}
            capturing={capturing}
            label={t("watch.rail.capture")}
            busyLabel={t("watch.rail.capturing")}
          />
          <button
            type="button"
            // 片 d：时间写歪了就按不动 —— 让他先改对，而不是按下去才知道（错的话下面那行正写着是哪一种）
            disabled={sending || !at.question.trim() || atError !== null}
            onClick={() => void send(input)}
            className="min-h-[42px] shrink-0 rounded-xl bg-teal-400 px-3.5 text-sm font-semibold text-teal-950 transition-colors hover:bg-teal-300 disabled:opacity-40"
          >
            {sending ? "…" : t("watch.qa.send")}
          </button>
        </div>

        {/* 片 d 的两句在最前面：他眼下正在改的就是那一行字，别让老的报错压着它 */}
        {(atError || captureError || sendError) && (
          <p role="alert" className="mt-1.5 text-xs leading-5 text-amber-300/90">
            {atError ? atErrorText(atError) : captureError || sendError}
          </p>
        )}
      </div>
    </div>
  );
}

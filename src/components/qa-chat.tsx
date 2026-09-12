"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCopy } from "@/components/copy-provider";
import type { PausePoint } from "@/components/pause-list";
import { toSegments } from "@/lib/chat-text";
import { mmss } from "@/lib/time";

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

/** 连着几轮 `t_s` 挨得这么近就不重复标 `@`（D55 原有的防吵规则，计划 §B.2） */
const REPEAT_LABEL_GAP_S = 30;

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
      /** 0 = 母问题，1 = 追问（缩进两格，计划 §B.4） */
      depth: 0 | 1;
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
 * 抽成函数是因为它有两个调用方：正常问一句、以及「说短一点」重答一版。
 * 两边逐字复制会漂移 —— 而流式协议这种东西一漂移，症状是"偶尔少最后半句"，
 * 最难查。
 */
async function streamAsk(
  body: { interruptId: string; question: string; brief?: boolean },
  onPiece: (fullSoFar: string) => void,
  fallbackError: string,
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
      let ev: { type?: string; text?: string; answer?: string; message?: string };
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      if (ev.type === "chunk" && ev.text) {
        full += ev.text;
        onPiece(full);
      } else if (ev.type === "done") {
        if (typeof ev.answer === "string") full = ev.answer;
        onPiece(full);
      } else if (ev.type === "error") {
        streamErr = ev.message ?? fallbackError;
      }
    }
  }
  // 服务端把错误当成流里的一条事件推回来（HTTP 早就 200 了），所以要在这儿抛
  if (streamErr) throw new Error(streamErr);
  if (!full.trim()) throw new Error(fallbackError);
  return full;
}

export function QaChat({
  hidden,
  points,
  onJump,
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
  getCurrentTime: () => number;
  pauseVideo: () => void;
  /** 落一个新捕获点，返回真 id（乐观点由调用方画，失败它自己撤） */
  createPoint: (tS: number, parentId: string | null) => Promise<string>;
  /** 一轮答完，把问题与答案回填进那份 `points`（点点条 / 问题列表吃的是同一份） */
  onAnswered: (id: string, question: string, answer: string) => void;
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
  } | null>(null);
  /** 连点都没落上（`createPoint` 就失败了）—— 这时候流里连一行都没有，只能在输入框下面说 */
  const [sendError, setSendError] = useState("");

  /** D56「说短一点」的短版，按轮次存。**只在内存里** —— 刷新就没，原答案永远是库里那份 */
  const [briefs, setBriefs] = useState<
    Map<string, { text: string; showing: boolean; busy: boolean; error: string }>
  >(() => new Map());

  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const keptScrollRef = useRef(0);
  const wasHiddenRef = useRef(hidden);
  /** 上一轮**答完那一刻**播放器的播放次数。追问判据就是拿它和现在比（§B.4） */
  const lastAnswerTickRef = useRef<number | null>(null);

  // 已落库、问过问题的轮次，**按落库时间排** ——
  // 不是按 `t_s`：往回拨一段再问一句，那句仍然是"最新的一条"，该排在最下面
  // （计划 §A：「最新的在最下面」）。片 d 的 `@` 指定时间点会更需要这条口径。
  const liveTurns = useMemo(() => {
    return points
      .filter((p) => (p.question ?? "").trim().length > 0)
      .slice()
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }, [points]);

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
        depth: p.parent_id ? 1 : 0,
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
        depth: flight.parentId ? 1 : 0,
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
  useEffect(() => {
    if (hidden) return; // 藏着的时候 scrollHeight 是 0，这会儿写 scrollTop 等于把它清零
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows, atBottom, hidden]);

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

  /** 真正把一句话发出去。`retryId` 有值 = 这一轮的点早就落好了，别再落一个 */
  const send = useCallback(
    async (raw: string, retryId?: string) => {
      const question = raw.trim();
      if (!question || sending) return;
      pauseVideo(); // 提问必先暂停（D33 的老规矩，计划 §B.1）
      setSendError("");
      setSending(true);
      setAtBottom(true);

      let id = retryId ?? null;
      let parentId: string | null = null;

      if (!retryId) {
        setInput("");
        const tS = Math.max(0, Math.round(getCurrentTime()));
        // ── 追问判据（计划 §B.4）：**上一轮答完之后播放器有没有播过** ──
        // 写死成"有没有播过"而不是"隔了几秒"是创始人定的口径：
        // 盯着答案读了两分钟再追问，那仍然是追问；看了十秒视频再问，那是新问题。
        // 顺带白捡「他问了几个回合才接着看」这份数据 —— 就是一串子问题的长度，不另埋点。
        const last = liveTurns[liveTurns.length - 1];
        const followUp = last && lastAnswerTickRef.current === getPlayTick();
        // 追问的追问仍然挂在**同一个母问题**下面 —— 只缩一格，不无限往右退
        parentId = followUp ? (last.parent_id ?? last.id) : null;
        setFlight({ id: null, tS, question, answer: "", parentId, error: "", reset: peekReset() });
        try {
          id = await createPoint(tS, parentId);
        } catch (e) {
          // 连点都没落上：这一轮**根本没发生过**，流里不该留一条半截的。
          //
          // ⚠️ **把他打的那句话放回输入框**（2026-09-09 实测补的）：
          // 上面 `setInput("")` 已经清空了，不还回去的话，他写的那句就这么没了 ——
          // 报错说得再清楚，让人重打一遍也还是把 D44 的「给一条人点得动的重试」丢了。
          setInput(question);
          setFlight(null);
          setSendError(e instanceof Error ? e.message : answerFailedText);
          setSending(false);
          return;
        }
        setFlight((f) => (f ? { ...f, id } : f));
      } else {
        setFlight((f) => (f ? { ...f, answer: "", error: "" } : f));
      }

      try {
        const full = await streamAsk({ interruptId: id!, question }, (soFar) => {
          setFlight((f) => (f ? { ...f, answer: soFar } : f));
        }, answerFailedText);
        // 答完了：交给上面那份 points（点点条 / 问题列表吃同一份），本地这条就退场
        lastAnswerTickRef.current = getPlayTick();
        onAnswered(id!, question, full);
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
    ],
  );

  /**
   * D56「说短一点」。三件事一起才算做对：
   * ① 原答案**不覆盖**（服务端那趟带 `brief` 就不写库）；
   * ② 两版**可来回切**（拿到过就只是切显示，不再花钱）；
   * ③ **不点就一分钱不花**（D44）。
   */
  const toggleBrief = useCallback(
    async (id: string, question: string) => {
      const have = briefs.get(id);
      if (have?.busy) return;
      if (have && have.text) {
        setBriefs((m) => new Map(m).set(id, { ...have, showing: !have.showing, error: "" }));
        return;
      }
      setBriefs((m) => new Map(m).set(id, { text: "", showing: true, busy: true, error: "" }));
      try {
        const full = await streamAsk({ interruptId: id, question, brief: true }, (soFar) => {
          setBriefs((m) => {
            const cur = m.get(id);
            return new Map(m).set(id, {
              text: soFar,
              showing: true,
              busy: true,
              error: cur?.error ?? "",
            });
          });
        }, answerFailedText);
        setBriefs((m) => new Map(m).set(id, { text: full, showing: true, busy: false, error: "" }));
      } catch {
        // 说不出是哪一种失败也要说"失败了"，并且**留一条人点得动的重试**（D44）
        setBriefs((m) =>
          new Map(m).set(id, { text: "", showing: false, busy: false, error: t("watch.qa.shorterFailed") }),
        );
      }
    },
    [briefs, answerFailedText, t],
  );

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
      {/* ── 消息流 ── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {rows.length === 0 && (
          <p className="text-xs leading-5 text-ink-500">{t("watch.rail.empty.chat")}</p>
        )}

        {rows.map((r, i) => {
          if (r.kind === "old") {
            const first = rows[i - 1]?.kind !== "old";
            return (
              <div key={r.key}>
                {/* 老记录只在**第一条**头上说一次来历，别每条都挂一顶帽子 */}
                {first && (
                  <div className="mb-2 border-b border-ink-700 pb-1.5">
                    <p className="text-[0.68rem] font-semibold text-ink-300">{t("watch.qa.oldTitle")}</p>
                    <p className="mt-0.5 text-[0.62rem] leading-4 text-ink-500">{t("watch.qa.oldHint")}</p>
                  </div>
                )}
                <div className={`${r.role === "user" ? "mt-3 pl-6 text-right" : "mt-1"} opacity-60`}>
                  {toSegments(r.text).map((s, j) => (
                    <p key={j} className="text-xs leading-5 text-ink-300">
                      {s}
                    </p>
                  ))}
                </div>
              </div>
            );
          }

          const brief = r.id ? briefs.get(r.id) : undefined;
          const showingBrief = Boolean(brief?.showing && (brief.text || brief.busy));
          const body = showingBrief ? (brief?.text ?? "") : r.answer;
          const isLast = r.id !== null && r.id === lastAnsweredId;

          return (
            <div
              key={r.key}
              // 互动记录里点一个问题，要靠它找到这一轮（片 c0）
              data-turn-id={r.id ?? undefined}
              className={`${i === 0 ? "" : "mt-4"} ${
                // 追问缩进两格 + 一条细线，看一眼就知道它挂在上面那句下面
                r.depth === 1 ? "border-l border-ink-700 pl-3" : ""
              }`}
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
                  className="ui-mono mb-1 rounded px-1 py-0.5 text-[0.62rem] text-teal-300 transition-colors hover:bg-ink-700 hover:text-teal-200"
                >
                  @{mmss(r.tS)}
                </button>
              )}

              {/* 提问靠右、回答靠左 —— 2026-08-01 创始人真机反馈：全贴左边分不清谁说的 */}
              <p className="pl-5 text-right text-xs leading-5 text-ink-100">{r.question}</p>

              <div className="mt-1.5">
                {r.error ? (
                  <div role="alert">
                    <p className="text-[0.68rem] leading-4 text-amber-300/90">{r.error}</p>
                    {r.id && (
                      <button
                        type="button"
                        onClick={() => void send(r.question, r.id!)}
                        disabled={sending}
                        className="mt-1 h-7 rounded-lg border border-ink-700 px-2 text-[0.68rem] text-ink-200 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                      >
                        {t("watch.qa.retry")}
                      </button>
                    )}
                  </div>
                ) : body ? (
                  <>
                    {showingBrief && (
                      <span className="mb-1 inline-block rounded bg-ink-700/70 px-1.5 py-0.5 text-[0.58rem] text-ink-300">
                        {t("watch.qa.shorterTag")}
                      </span>
                    )}
                    {toSegments(body).map((s, j) => (
                      <p key={j} className="text-xs leading-5 text-ink-200">
                        {s}
                      </p>
                    ))}
                    {(r.live || brief?.busy) && <FermataDots />}
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

              {/* ── 答完之后的三连（计划 §B.6 + D56）──
                  为什么在**答案之后**而不是提问之前：人默认问浅问题，
                  推力要加在看完答案那一刻。只挂最后一轮，见上面 lastAnsweredId */}
              {isLast && !r.error && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void send(t("watch.qa.whyQ"))}
                    disabled={sending}
                    className="h-7 rounded-full border border-ink-700 px-2.5 text-[0.66rem] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                  >
                    {t("watch.qa.why")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void send(t("watch.qa.relationQ"))}
                    disabled={sending}
                    className="h-7 rounded-full border border-ink-700 px-2.5 text-[0.66rem] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                  >
                    {t("watch.qa.relation")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleBrief(r.id!, r.question)}
                    disabled={Boolean(brief?.busy)}
                    className="h-7 rounded-full border border-ink-700 px-2.5 text-[0.66rem] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
                  >
                    {brief?.busy
                      ? t("watch.qa.shorterGoing")
                      : showingBrief
                        ? t("watch.qa.shorterBack")
                        : t("watch.qa.shorter")}
                  </button>
                  {brief?.error && (
                    <p role="alert" className="w-full text-[0.62rem] leading-4 text-amber-300/90">
                      {brief.error}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
            className="mb-1 h-7 w-full rounded-lg bg-ink-700/70 text-[0.66rem] text-ink-200 transition-colors hover:text-teal-300"
          >
            {t("watch.qa.toLatest")}
          </button>
        </div>
      )}

      {/* ── D63 钉在这儿那条：**动作**，一键回去，不用滚。片 c0 起由 qa-rail 画好递进来（三个栏共用一块）── */}
      {pinBar}

      {/* ── 输入条 ── */}
      <div className="shrink-0 border-t border-ink-700 px-2 py-2">
        {/* 一行三样：输入框 · 「只记下这一刻」 · 发送。
            **它们在同一行是量出来的，不是排版偏好**：1512×859 上这一栏总共只有 269px，
            把捕获按钮单摆一行，能滚的消息流只剩 133px（≈5 行字）。并进这一行之后是 167px。
            §F 原话本来就是「输入框**边上**一颗小按钮」—— 同一行才是它说的那个位置。 */}
        <div className="flex items-end gap-1.5">
          <textarea
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
            }}
            rows={1}
            placeholder={t("watch.qa.placeholder")}
            className="max-h-24 min-h-9 min-w-0 flex-1 resize-none rounded-xl border border-ink-700 bg-ink-900 px-2.5 py-2 text-xs leading-5 text-ink-100 placeholder:text-ink-500 focus:border-teal-400 focus:outline-none"
          />
          {/* 「只记下这一刻」**搬到输入框边上了**（片 a 把它临时摆在空态里，§F 说的家就是这儿）。
              它是悬浮球在宽屏上的替身：先记下来，待会儿再问 —— 记完点点条上当场多一个点。 */}
          <button
            type="button"
            onClick={onCaptureNow}
            disabled={capturing}
            className="min-h-9 shrink-0 rounded-xl border border-ink-700 px-2 text-[0.66rem] text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:pointer-events-none disabled:opacity-50"
          >
            {capturing ? t("watch.rail.capturing") : t("watch.rail.capture")}
          </button>
          <button
            type="button"
            disabled={sending || !input.trim()}
            onClick={() => void send(input)}
            className="min-h-9 shrink-0 rounded-xl bg-teal-400 px-3 text-xs font-semibold text-teal-950 transition-colors hover:bg-teal-300 disabled:opacity-40"
          >
            {sending ? "…" : t("watch.qa.send")}
          </button>
        </div>

        {(captureError || sendError) && (
          <p role="alert" className="mt-1.5 text-[0.66rem] leading-4 text-amber-300/90">
            {captureError || sendError}
          </p>
        )}
      </div>
    </div>
  );
}

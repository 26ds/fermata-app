"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityPanel } from "@/components/activity-panel";
import { useCopy } from "@/components/copy-provider";
import type { Tagging } from "@/components/kind-tags";
import type { PausePoint } from "@/components/pause-list";
import { QaChat } from "@/components/qa-chat";
import type { CopyKey } from "@/lib/copy/keys";
import { mmss } from "@/lib/time";
import type { SourceKind } from "@/lib/types";
import type { SeekVia } from "@/lib/watch-events";
import type { WatchRecorder } from "@/lib/watch-recorder";

// M3.15 片 a —— 右栏三个栏目的**骨架**（计划 §A / D61）。
//
// 三个 tab：① 问答 ② 互动记录 ③ Takeaway。同一时刻只显示一个。
// **字幕不是其中之一** —— 它按布局模式待在别处（§D），片 a 里就还在这三个栏上面。
//
// **片 b 把第一栏填上了**（`qa-chat.tsx`）。
// **片 c0 把第二栏换掉了**（D71）：「问题列表」并进来、改名「互动记录」（`activity-panel.tsx`）——
// 问题和跳转本在同一条时间线上，拆成两个 tab 就把它剪断了；原来的问题列表 = 它顶上的「只看提问」。
// ③ 仍是空态，片 e 的活。**空态里写「功能开发中」是照 `watch.captures.help` 的规矩**（D44：
// 没做的事不许在界面上说得像做好了）——**反过来也成立**：做好了的事不许还写着"开发中"。
//
// ── 片 c0：D63 钉着的那块返回牌搬到这儿来了 ────────────────────────────
// 片 b 时它长在问答栏里（输入框上面）。现在互动记录里的每个时间也能把人送走 ——
// 牌子要是还藏在「问答」栏里，在互动记录里点完就看不见它，**看不见就等于没有**（D63 要的是「随时点得到、不用滚」）。
// 所以牌子的状态归三个栏共用的这一层：在「问答」里它照旧长在输入框上面（和片 b 一个像素不差），
// 另外两栏里它钉在底部。**D63 已经验过的行为一条都没变**：只留最近一次；±N 秒不撤；
// 点捕获轴撤；用户在播放器上自己跳撤。

export type QaTab = "chat" | "activity" | "takeaway";

/** 顺序就是界面上的顺序。**key 写死成字面量**，不拿模板串拼 —— 拼出来的 key 逃过类型检查，
 *  漏一条要等到运行时才看得见（而 `en.ts` 漏一条编译不过的那道闸门也就白设了） */
const TABS = [
  { id: "chat", label: "watch.rail.tab.chat" },
  { id: "activity", label: "watch.rail.tab.activity" },
  { id: "takeaway", label: "watch.rail.tab.takeaway" },
] as const satisfies readonly { id: QaTab; label: CopyKey }[];

/** 每个 tab 管哪一块面板（读屏的人靠 aria-controls 知道点了会露出哪一块） */
const PANEL_ID: Record<QaTab, string> = {
  chat: "qa-rail-panel-chat",
  activity: "qa-rail-panel-activity",
  takeaway: "qa-rail-panel",
};

/** ↩ 那个箭头（返回牌上的）。从 qa-chat 搬过来的 —— 流里那条灰线没了，只剩这一处用它 */
function BackArrow() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden focusable="false">
      <path
        d="M5 2.5 2 5.5l3 3M2.4 5.5H7a3 3 0 0 1 0 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type ChatProps = React.ComponentProps<typeof QaChat>;

// ── 片 g3：问答栏的字号（「字体 − +」）────────────────────────────────────
//
// 创始人 2026-09-23：「在对话栏加一个可以调整聊天界面大小的按钮，加或者减，上面写着"字体"……放到这个聊天栏的右上角吧（Takeaway 的最右边）」。
// 管的是**消息流里的字**（提问气泡、回答、概述卡、角标、答完那排按钮）—— 那一层的字号全写成 em、挂在 `--chat-fs` 上（qa-chat.tsx）。
// tab 这一行和底下的输入框不跟着变：它们是按钮，不是要读的东西。
//
// 按设备记（localStorage），和字幕字号同一个脾气：字号是「这块屏幕上看着舒服」的事，换台电脑本来就该重调。
// 走模块级小仓库 + `useSyncExternalStore`（和 watch-stage 的「播放控制条收起」同一个写法）：
// 服务端渲染不出 localStorage，走 state 就是一次必然的水合不一致。
const CHAT_SIZE_KEY = "fermata.chat.size";
/**
 * 默认 15px（片 g3 之前是 14px 的 `text-sm`）：换成衬线之后，同样 14px 看着小一圈 ——
 * Source Serif 的小写字母比 Inter 矮约一成，宋体的字面也比苹方小。大 1px 是为了**看着和原来一样大**，不是为了更大
 */
const CHAT_SIZE_DEFAULT = 15;
const CHAT_SIZE_MIN = 12;
const CHAT_SIZE_MAX = 22;
let chatSize = CHAT_SIZE_DEFAULT;
let chatSizeLoaded = false;
const chatSizeListeners = new Set<() => void>();

function getChatSize(): number {
  if (!chatSizeLoaded) {
    chatSizeLoaded = true;
    try {
      const v = Number(window.localStorage.getItem(CHAT_SIZE_KEY));
      // 存坏了 / 别的版本存的越界值 → 当没存过
      if (Number.isInteger(v) && v >= CHAT_SIZE_MIN && v <= CHAT_SIZE_MAX) chatSize = v;
    } catch {
      // Safari 无痕模式下 localStorage 会抛。记不住比崩了强
    }
  }
  return chatSize;
}
const getChatSizeOnServer = () => CHAT_SIZE_DEFAULT;

function subscribeChatSize(cb: () => void): () => void {
  chatSizeListeners.add(cb);
  return () => {
    chatSizeListeners.delete(cb);
  };
}

function setChatSize(next: number) {
  const v = Math.max(CHAT_SIZE_MIN, Math.min(CHAT_SIZE_MAX, next));
  if (v === chatSize) return;
  chatSize = v;
  try {
    window.localStorage.setItem(CHAT_SIZE_KEY, String(v));
  } catch {
    // 同上：存不下就只在这一次观看里有效
  }
  for (const cb of chatSizeListeners) cb();
}

/** − / + 的小图标。画出来而不是打字：两个字符在不同字体里粗细对不齐 */
function StepIcon({ plus }: { plus: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden focusable="false">
      <path d={plus ? "M2.5 6h7M6 2.5v7" : "M2.5 6h7"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 「字体 − +」。**点一下只重画这颗按钮**：字号写成外面那一层的 CSS 变量（直接改 DOM），
 * 问答栏整条不重画（修补轮的 INP 教训 —— 攒了几十轮问答时，整条重画是看得出的卡）。
 * 到头了那一边变灰、点不动（D44：「点了没反应」要看得出是到头了，不是坏了）
 */
function ChatTextSize({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const t = useCopy();
  const size = useSyncExternalStore(subscribeChatSize, getChatSize, getChatSizeOnServer);
  useEffect(() => {
    targetRef.current?.style.setProperty("--chat-fs", `${size}px`);
  }, [size, targetRef]);
  const btn =
    "flex h-7 w-7 items-center justify-center text-ink-300 transition-colors enabled:hover:bg-ink-700 enabled:hover:text-teal-300 disabled:opacity-35";
  return (
    <div
      role="group"
      aria-label={t("watch.rail.fontAria", size)}
      className="ml-auto flex shrink-0 items-center overflow-hidden rounded-lg border border-ink-700"
    >
      <button
        type="button"
        onClick={() => setChatSize(size - 1)}
        disabled={size <= CHAT_SIZE_MIN}
        aria-label={t("watch.rail.fontSmaller")}
        title={`${t("watch.rail.fontSmaller")} · ${size}px`}
        className={btn}
      >
        <StepIcon plus={false} />
      </button>
      {/* 「字体」两个字（他点名要写上的）。这一栏太窄时收起来、只留 − +（读屏照样念得到组名） */}
      <span aria-hidden className="select-none px-1 text-[0.68rem] text-ink-500 @max-[20rem]:hidden">
        {t("watch.rail.font")}
      </span>
      <button
        type="button"
        onClick={() => setChatSize(size + 1)}
        disabled={size >= CHAT_SIZE_MAX}
        aria-label={t("watch.rail.fontLarger")}
        title={`${t("watch.rail.fontLarger")} · ${size}px`}
        className={btn}
      >
        <StepIcon plus />
      </button>
    </div>
  );
}

/**
 * ③ Takeaway 自己记自己的滚动位置（片 a 的交付判据之一：三个栏各记各的）。
 *
 * ⚠️ **不能只靠"都挂着、用 CSS 藏起来"** —— 元素一旦 `display:none`，部分浏览器会把 `scrollTop` 抹成 0。
 * ①② 各自是独立的滚动容器、自己记（写法见 qa-chat.tsx / activity-panel.tsx：在 `onScroll` 里一路记着）；
 * ③ 还是片 a 那个写法：切走那一刻记进 ref，切回来在 `useLayoutEffect` 里写回去。
 */
export function QaRail({
  onCaptureNow,
  capturing,
  captureError,
  pointCount,
  points,
  onSeek,
  getCurrentTime,
  userSeekTick,
  recorder,
  durationS,
  sourceKind,
  eventsCapped,
  eventsLoadFailed,
  atHintSeen,
  onAtHintSeen,
  tagging,
  chat,
}: {
  /**
   * 「只记下这一刻，先不问」。**这是悬浮球在宽屏上的替身**（§F）——
   * 片 b 已经把它挪到输入框边上了（`qa-chat.tsx` 里那颗），这里只负责往下传。
   */
  onCaptureNow: () => void;
  capturing: boolean;
  /** 没记上就要说是哪一种失败，**不许静默**（D44） */
  captureError: string;
  pointCount: number;
  /** 这条内容所有的捕获点 —— 问答栏、互动记录、捕获轴吃的是同一份 */
  points: PausePoint[];
  /** 就地跳（D33 死线：不换路由）。`via` 说清楚是哪颗控件发起的（D71） */
  onSeek: (t: number, via: SeekVia) => void;
  getCurrentTime: () => number;
  /** 用户**自己**动了播放头的次数（播放器上跳 / 点捕获轴 / 点字幕）。D63：一动就撤掉钉着那块 */
  userSeekTick: number;
  recorder: WatchRecorder;
  durationS: number;
  sourceKind: SourceKind;
  eventsCapped: boolean;
  eventsLoadFailed: boolean;
  /** 片 d：`@` 那张单子自动弹过一次了吗（`user_settings.atHintSeen`，**零新迁移**）。壳不用它，原样往下递 */
  atHintSeen: boolean;
  onAtHintSeen: () => void;
  /** 片 d 的另一半（D65）：问题标签那一套。问答栏（他那句问题下面）和互动记录（「只看提问」）两处都用，原样往下递 */
  tagging: Tagging;
  /** 问答那一栏要的其余东西。壳不认识它们，原样往下递 */
  chat: Omit<
    ChatProps,
    | "hidden"
    | "points"
    | "getCurrentTime"
    | "onJump"
    | "onJumpCard"
    | "pinBar"
    | "focusTurn"
    | "labelResets"
    | "peekReset"
    | "onCaptureNow"
    | "capturing"
    | "captureError"
    | "canLook"
    | "durationS"
    | "atHintSeen"
    | "onAtHintSeen"
    | "tagging"
  >;
}) {
  const t = useCopy();
  /**
   * 现在露在外面的是哪一栏。**每次进这一页都从「问答」开始** —— 记住上次选的是片 g 的事。
   *
   * ⚠️ **这个 state 住在这一层，不住在 watch-stage**（2026-09-13，INP）。片 a 把它放在 watch-stage 上，
   * 于是点一下 tab 就是整页重画（几百行字幕、捕获轴、两个栏）—— lab 页上点一次 288ms（开发模式，其中处理 254ms）。
   * watch-stage 除了把它递过来，从来没有别处读过它；挪进来之后，切 tab 只重画这三个栏。
   */
  const [tab, setTab] = useState<QaTab>("chat");
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 片 g3：「字体 − +」把字号写在这一层（`--chat-fs`），消息流从这儿继承 */
  const sectionRef = useRef<HTMLElement>(null);
  const takeawayScrollRef = useRef(0);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && tab === "takeaway") el.scrollTop = takeawayScrollRef.current;
  }, [tab]);

  const switchTo = useCallback(
    (next: QaTab) => {
      if (next === tab) return;
      const el = bodyRef.current;
      if (el && tab === "takeaway") takeawayScrollRef.current = el.scrollTop;
      setTab(next);
    },
    [tab],
  );

  // ── D63：钉着的返回牌（**只留最近一次**）──
  const [pinned, setPinned] = useState<number | null>(null);
  // **用户自己动了播放头就撤掉**（他知道自己在干嘛）。写成"渲染时对一眼"而不是 `useEffect` 里 setState：
  // 这个仓库里 `react-hooks/set-state-in-effect` 已经拦过好几次，而 React 官方给
  // 「外部值变了要顺手改一个 state」的写法就是这个（不提交、直接重来一遍渲染）。
  // ⚠️ 这里不需要"这一跳是不是我们干的"的判断：我们的链接（`@`、互动记录里的时间、±N、返回牌）
  // 在 watch-stage 那一头就不会让 `userSeekTick` 变（`KEEPS_BACK_CARD`）。
  const [seenSeekTick, setSeenSeekTick] = useState(userSeekTick);
  if (userSeekTick !== seenSeekTick) {
    setSeenSeekTick(userSeekTick);
    if (pinned !== null) setPinned(null);
  }

  /** 被我们的链接送走：**先记下他现在在哪**、立牌子，再跳（这一跳自己也在互动记录里记一行） */
  const jump = useCallback(
    (toS: number, via: "at_link" | "record" | "card") => {
      // 记精确的秒数（片 b 这里四舍五入到整秒）：牌子上的「回到 00:36」要和互动记录那一行的「00:36 → …」
      // 对得上（mm:ss 一律往下取整，lab 页上两边差过 1 秒），点回去也回到分毫不差的那一刻
      const from = Math.max(0, getCurrentTime());
      // 跳去的地方就是脚下这一秒（差一秒以内），那不叫"被送走"，别为它立牌子
      if (Math.abs(from - toS) < 1) return;
      setPinned(from);
      onSeek(toS, via);
    },
    [getCurrentTime, onSeek],
  );
  const jumpFromChat = useCallback((toS: number) => jump(toS, "at_link"), [jump]);
  const jumpFromRecord = useCallback((toS: number) => jump(toS, "record"), [jump]);
  // 片 c 概述卡：`card` 早在片 c0 就进了 SEEK_VIAS 和 KEEPS_BACK_CARD（互动记录写「点概述卡」、牌子不撤）
  const jumpFromCard = useCallback((toS: number) => jump(toS, "card"), [jump]);

  const goBack = useCallback(() => {
    if (pinned === null) return;
    onSeek(pinned, "back");
    setPinned(null);
  }, [pinned, onSeek]);

  /** 互动记录里点了一个问题：切到「问答」、滚到那一轮、闪一下 —— **不动视频**（D71） */
  const [focusTurn, setFocusTurn] = useState<{ id: string; n: number } | null>(null);
  const openTurn = useCallback(
    (id: string) => {
      switchTo("chat");
      setFocusTurn((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    },
    [switchTo],
  );

  // 问答栏的 `@` 标注从哪一轮重新算。记录器只在多了一问时才换一个新的 Set —— 平时每秒那一下叫不醒这一层
  const labelResets = useSyncExternalStore(recorder.subscribe, recorder.getLabelResets, recorder.getLabelResets);

  const pinBar =
    pinned === null ? null : (
      <div className="flex items-center gap-1 border-t border-ink-700 px-2 py-1.5">
        <button
          type="button"
          onClick={goBack}
          className="flex min-h-8 flex-1 items-center gap-1.5 rounded-lg px-2 text-left text-[0.68rem] text-teal-300 transition-colors hover:bg-ink-700"
        >
          <BackArrow />
          {t("watch.qa.backTo", mmss(pinned))}
        </button>
        <button
          type="button"
          onClick={() => setPinned(null)}
          aria-label={t("watch.qa.backDismiss")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-700 hover:text-ink-100"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
    );

  return (
    // `min-h-0` + 里面那层 `overflow-y-auto`：两个一起才成立 —— flex 子项不写
    // `min-h-0` 就不肯缩到内容以下，overflow 永远触发不了（和右栏同一条老规矩）。
    // `@container`：tab 条按**这一栏自己有多宽**收紧，不按窗口 —— 见下面那段
    <section
      ref={sectionRef}
      aria-label={t("watch.rail.aria")}
      className="@container flex min-h-0 flex-1 flex-col rounded-2xl border border-ink-700"
      style={{ "--chat-fs": `${CHAT_SIZE_DEFAULT}px` } as React.CSSProperties}
    >
      {/* 三个 tab。用 role=tablist 而不是三颗光秃秃的按钮：读屏的人要听得出
          「三选一」和「当前是第几个」，那是 aria-selected 才给得了的信息。

          ⚠️ 片 c0 开工先量第 1 条：右栏最窄时（1024 宽、中缝拖到 78%）这一栏只有 **181px** ——
          英文的 `Ask · Questions 5 · Takeaway` **今天就已经挤出去 45px**，换成 `Activity 5` 也还差 31px
          （中文 `问答 · 互动记录 5 · Takeaway` 刚好 0px 放下）。所以这一栏窄于 13.5rem 时才把内边距收紧：
          平时的样子一个像素不动，只有最窄那一档变紧。 */}
      {/* 片 g3：tab 那一行最右边多了「字体 − +」—— 它不是 tab，所以 `role="tablist"` 往里挪了一层（tablist 里只许放 tab）。
          `flex-wrap`：右栏拖到最窄（1024 宽、中缝 78% ≈ 187px）时它折到第二行，不许挤出这一栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-ink-700 px-2 py-1.5 @max-[13.5rem]:gap-0.5 @max-[13.5rem]:px-1">
        <div
          role="tablist"
          aria-label={t("watch.rail.aria")}
          className="flex items-center gap-1 @max-[13.5rem]:gap-0.5"
        >
          {TABS.map(({ id, label }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`qa-tab-${id}`}
                aria-selected={active}
                aria-controls={PANEL_ID[id]}
                onClick={() => switchTo(id)}
                className={`h-8 rounded-lg px-2.5 text-[0.72rem] transition-colors @max-[13.5rem]:px-1.5 ${
                  active ? "bg-ink-700/60 text-teal-300" : "text-ink-500 hover:text-ink-300"
                }`}
              >
                {t(label)}
                {/* 互动记录那一颗顺带报个数 = 捕获点个数 —— 捕获轴上已经有这个数（「5 个」），两处对得上才不让人犯嘀咕 */}
                {id === "activity" && pointCount > 0 ? (
                  <span className="ui-mono ml-1 text-[0.62rem] text-ink-500">{pointCount}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <ChatTextSize targetRef={sectionRef} />
      </div>

      {/* ① 问答：**永远挂着**，切走只是 hidden（正在流式的答案不能被卸载打断）。
          返回牌在这一栏里仍然长在输入框上面 —— 由它自己摆（`pinBar`） */}
      <QaChat
        {...chat}
        hidden={tab !== "chat"}
        points={points}
        getCurrentTime={getCurrentTime}
        onJump={jumpFromChat}
        onJumpCard={jumpFromCard}
        pinBar={tab === "chat" ? pinBar : null}
        focusTurn={focusTurn}
        labelResets={labelResets}
        peekReset={recorder.peekReset}
        onCaptureNow={onCaptureNow}
        capturing={capturing}
        captureError={captureError}
        // M3.16（D75）：「看画面再答」只在 YouTube 上出现 —— 播客没有画面
        canLook={sourceKind === "youtube"}
        durationS={durationS}
        atHintSeen={atHintSeen}
        onAtHintSeen={onAtHintSeen}
        tagging={tagging}
      />

      {/* ② 互动记录：也**永远挂着**（各记各的滚动位置），但藏着的时候不订记录器、不每秒重画 */}
      <ActivityPanel
        hidden={tab !== "activity"}
        recorder={recorder}
        // D73：顶上那条的「现在在哪」那根针直接问播放器
        getCurrentTime={getCurrentTime}
        points={points}
        durationS={durationS}
        kind={sourceKind}
        capped={eventsCapped}
        loadFailed={eventsLoadFailed}
        onJump={jumpFromRecord}
        onOpenTurn={openTurn}
        tagging={tagging}
      />

      {/* ③ Takeaway 还是空态 —— 片 e 的活 */}
      {tab === "takeaway" && (
        <div
          ref={bodyRef}
          role="tabpanel"
          id="qa-rail-panel"
          aria-labelledby="qa-tab-takeaway"
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          <p className="text-xs leading-5 text-ink-500">{t("watch.rail.empty.takeaway")}</p>
        </div>
      )}

      {/* 另外两栏里，返回牌钉在底部 —— 在互动记录里点时间跳走，牌子就在眼前（片 c0 交付判据第 5 条） */}
      {tab !== "chat" ? pinBar : null}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeSegmentIndex, segmentsInWindow } from "@/lib/captions";
import { CaptionLayer } from "@/components/caption-layer";
import { CaptureOrb } from "@/components/capture-orb";
import { DotBar } from "@/components/dot-bar";
import { ImmersiveChat } from "@/components/immersive-chat";
import { InterruptPanel, type PanelLine } from "@/components/interrupt-panel";
import type { PausePoint } from "@/components/pause-list";
import { PlayerControls } from "@/components/player-controls";
import type { GlossState } from "@/components/selectable-line";
import { ViewportLayer } from "@/components/viewport-layer";
import { useWordLookup } from "@/components/word-lookup";
import { DEFAULT_LANG_PREFS, type LangPrefs } from "@/lib/lang";
import {
  isPhraseScan,
  resolvePhrases,
  scanDrift,
  type PhraseItem,
  type PhraseScan,
} from "@/lib/phrases/types";
import { DEFAULT_PLAY_PREFS, type PlayPrefs } from "@/lib/play-prefs";
import { findTerms } from "@/lib/segment";
import { putSettings } from "@/lib/settings-client";
import { playerFor } from "@/lib/sources/players";
import type { PlayerHandle } from "@/lib/sources/types";
import { mmss } from "@/lib/time";
import type {
  QuestionMode,
  SourceKind,
  SourceRow,
  TranscriptSegment,
  TranscriptStatus,
} from "@/lib/types";

/** 进度回写节流：播放中最快 10 秒存一次，别把网络当秒表用 */
const SAVE_EVERY_MS = 10_000;

// ── M3.12 片 b：可拖中缝（D47 §B / §B2） ──────────────────────────────
//
// 分栏比例只在 `lg:`（≥1024px）起作用，窄屏一律竖着排，这几个数用不上。

/** Tailwind `lg` 断点。宽屏专有的量尺不在窄屏上白跑 */
const LG_PX = 1024;
/** 中缝能拖到的范围。50 以下右栏比视频还宽、78 以上右栏塞不下一行字幕 */
const SPLIT_MIN = 50;
const SPLIT_MAX = 78;
/**
 * 默认比例。**播客不是 16:9** —— 左边是方形封面 + `<audio>`，撑不起 62%，
 * 硬给就是一大片空；而播客的主战场本来就是字幕（D47 §B2）。
 */
const SPLIT_DEFAULT: Record<"video" | "podcast", number> = { video: 62, podcast: 45 };
/** 键盘拖：一下 2%（方向键），Home 复位 */
const SPLIT_STEP = 2;
const SPLIT_KEY = "fermata.watch.splitPct";
/**
 * 手指/鼠标横着挪不到这么多像素，就**不算拖**（连遮罩都不盖）。
 *
 * 这不是"手感调优"，是**双击复位能不能用**的前提：遮罩一盖上，第一次的 `mouseup`
 * 就落在遮罩上而不是缝上 —— 两次 click 的落点不是同一个元素，浏览器**根本不会**
 * 派发 `dblclick`。实测过：不设这道门槛，双击复位一次都触发不了，
 * 反而把当前比例又存了一遍。
 */
const DRAG_THRESHOLD_PX = 3;

/**
 * 高度上限（D47 账二）：视频是 16:9，**宽度一涨高度跟着涨** ——
 * 桌面真正的天花板是"窗口有多高"，不是多宽。这两个数是这条上限的两个兜底：
 * 视频上下那些东西之外再留一点（`main` 的 `lg:pb-4`），以及左栏无论如何不低于多少。
 */
const CAP_SPARE_PX = 16;
const CAP_FLOOR_PX = 280;
/** 量出来的上限和上一次差不到这么多就不写回去 —— 挡住「写 → 回流 → 再量」的抖动 */
const CAP_EPSILON_PX = 4;

/**
 * 视频和播客**分开记**（D47 §B2）：看视频调好的宽度，不该在听播客时被套用。
 * `manual` 归到视频那一档 —— 它没有播放器，走哪个默认都无所谓，别为它多开一个键。
 */
function splitKindOf(kind: SourceKind): "video" | "podcast" {
  return kind === "podcast" ? "podcast" : "video";
}

/** 比例按设备记，不进数据库：桌面比例本来就是每台机器各不相同的事（D47 §B，零迁移） */
function readSplit(kind: "video" | "podcast"): number | null {
  try {
    const raw = window.localStorage.getItem(`${SPLIT_KEY}.${kind}`);
    const pct = Number(raw);
    // 存坏了（手改过、旧版本、别的站点撞名）就当没存过，回默认值，别把布局搞成负数
    return Number.isFinite(pct) && pct >= SPLIT_MIN && pct <= SPLIT_MAX ? pct : null;
  } catch {
    // Safari 无痕模式下 localStorage 会抛。记不住比崩了强
    return null;
  }
}

function writeSplit(kind: "video" | "podcast", pct: number) {
  try {
    window.localStorage.setItem(`${SPLIT_KEY}.${kind}`, String(Math.round(pct)));
  } catch {
    // 同上：存不下就只在这一次观看里有效
  }
}

/**
 * M1 的中枢：拿到 PlayerHandle，持续知道"现在播到第几秒"。
 * 悬浮球（1b）、点点条 + 打断面板（1c）都挂在这里。
 * 它只认 SourceRow + PlayerHandle —— 底下播的是 YouTube 还是播客，这里不知道也不该知道。
 */
export function WatchStage({
  source,
  interrupts,
  startAtS,
  startInChat,
  prefs = DEFAULT_LANG_PREFS,
  play = DEFAULT_PLAY_PREFS,
  autoScan: autoScanInitial = false,
  savedAtoms = [],
}: {
  source: SourceRow;
  interrupts: PausePoint[];
  /**
   * M3.6：`/watch/[id]?t=<秒>`。从「历史与知识库」里点一个暂停点过来的 ——
   * 那一页没有播放器，只能真跳页，所以落地时要自己把播放头放到那一秒。
   */
  startAtS?: number | null;
  /** M3.6：`?chat=1`。从回看页点「和这条内容聊过 N 轮」过来的，落地直接进沉浸层 */
  startInChat?: boolean;
  /** M3.7 / D42：三个语言（母语 / 目标语言 / 译文语言），服务端读出来传下来 */
  prefs?: LangPrefs;
  /** 倍速 + 一跳几秒。服务端首屏就给，省得进来先显示 1× 再"跳"成 1.5× */
  play?: PlayPrefs;
  /**
   * AI 自动标词开着吗（D45）。**默认关** —— 手动选词才是主路径，
   * 一个降级成"顺带提示"的功能不该还在背后自己花钱。开关在暂停面板里那一行。
   */
  autoScan?: boolean;
  /** M3.7：这条内容里已经收进词库的词组（决定 ✓ 是实心还是空心） */
  savedAtoms?: { id: string; term: string }[];
}) {
  // 只问"用哪个壳"。这条链接是什么平台、叫什么名字，是服务端 registry 的活（M1d）
  const shell = playerFor(source.kind);

  const handleRef = useRef<PlayerHandle | null>(null);
  const currentTimeRef = useRef(0);
  const durationSentRef = useRef(source.duration_s != null);
  const durationKnownRef = useRef((source.duration_s ?? 0) > 0);
  const lastSavedAtRef = useRef(0);
  const lastSavedValueRef = useRef(source.last_position_s ?? 0);
  const clockRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  // 这两个走 ref：暂停回调可能比 state 更新更快，判断必须同步
  const playingRef = useRef(false);
  const panelOpenRef = useRef(false);
  const resumeOnCloseRef = useRef(false);
  // 沉浸态也走 ref：进入时 pause() 会触发 onPause，必须在那之前就置位，
  // 否则 handlePause 会把短问答面板弹到沉浸层底下（同步判断，state 太慢）
  const immersiveRef = useRef(Boolean(startInChat));
  // ?t= 只认一次：跳过去之后就作废，别在播放器每次重建时把人拽回原点
  const startAtRef = useRef(startAtS ?? null);
  // 观看历史只写一次（每次进这一页），别把「看过 N 次」写成"播放键按了几下"
  const watchedSentRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  /**
   * 这一次进来，画面**真的动过**吗（收到过一次 PLAYING）。
   * 只用来拦 ±N 秒 —— 从没播过的播放器一 seek 就变黑（见 seekBy 上的说明）。
   * 暂停之后仍然是 true：播过一帧之后再跳，画面是好的（复现验过）。
   */
  const [started, setStarted] = useState(false);
  const [durationS, setDurationS] = useState(source.duration_s ?? 0);
  // M2a：字幕不再是一份死数据，它会边转边长 —— 收进 state 才能实时往下传。
  // **D50：这里不做简繁转换** —— 送到浏览器的字幕已经是最终字形了（观看页在服务端转、
  // 边转边长那路由 `/api/transcript` 转）。词库 1MB，不该让每个用户下载一遍。
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(source.transcript);
  const [status, setStatus] = useState<TranscriptStatus>(source.transcript_status);
  const [gen, setGen] = useState<{
    running: boolean;
    coveredS: number | null;
    error: string;
  }>({ running: false, coveredS: null, error: "" });
  const runningRef = useRef(false);
  // 字幕本体。热路径（250ms 那一轮）要查"这一刻有没有字幕"，所以走 ref
  const segmentsRef = useRef<TranscriptSegment[]>(source.transcript ?? []);
  const orbReadyRef = useRef(false);
  const [orbReady, setOrbReady] = useState(false);
  const [points, setPoints] = useState<PausePoint[]>(interrupts);
  const [panel, setPanel] = useState<{
    open: boolean;
    tS: number;
    id: string | null;
    captured: boolean;
  }>({
    open: false,
    tS: 0,
    id: null,
    captured: false,
  });
  // 这条打断点落库的 promise —— handleAsk 直接 await，避免"刚开面板就问"时重复落库
  const panelIdRef = useRef<Promise<string | null> | null>(null);
  const panelTSRef = useRef(0);
  // M3 打断问答：流式答案状态
  const [ask, setAsk] = useState<{ asking: boolean; answer: string; error: string }>({
    asking: false,
    answer: "",
    error: "",
  });
  // M3 Phase-2：长问答沉浸聊天是观看页上的一层浮层（状态开关，不是新路由）——
  // 播放器实例永不卸载，退出不重载、不跳回开头（WORKORDER D33 / design §99）。
  const [immersive, setImmersive] = useState(Boolean(startInChat));

  // === 倍速 + 一跳几秒（2026-08-01 真机反馈第二轮） ===
  // rate 这个 state 是**播放器实测值的镜子**，不是"我们请求的值"：YouTube 有权不认某个倍速，
  // 而显示一个按不出来的数比不显示还糟。rateRef 才记着"用户选的"，播放器每次就绪都按它重设一遍
  // （换片 / 从沉浸态回来 / iOS 回收后重建，倍速都会被打回 1）。
  const [rate, setRate] = useState(play.rate);
  const [skipStep, setSkipStep] = useState(play.skipStep);
  const rateRef = useRef(play.rate);
  /** 牌子上正显示的那个数（给 250ms 那轮比对用，走 ref 才不会读到过期闭包） */
  const shownRateRef = useRef(play.rate);

  // === M3.7 词库（D40 + D42） ===
  // 整片扫出来的词组。首屏直接吃服务端那份（`sources.phrases`）—— 扫过的片子
  // **一进来高亮就在**，不用等任何请求（验收⑤"重看不再花钱"的可见部分）。
  const [scan, setScan] = useState<PhraseScan | null>(
    isPhraseScan(source.phrases) ? source.phrases : null,
  );
  /**
   * 扫描这件事**必须能被看见**（M3.7 真机第一轮的教训）。
   * 原来失败一律静默，于是"扫描中闪一下然后什么都没有"可能是四种完全不同的原因 ——
   * 字幕没转完 / 上次崩了留下并发锁 / 真的一个词都没标出来 / 报错 ——
   * 而用户和我都无从分辨。**说不清楚的失败等于没做。**
   */
  const [scanState, setScanState] = useState<{
    status: "idle" | "off" | "scanning" | "ready" | "empty" | "not-ready" | "running" | "failed";
    count: number;
  }>({
    // D45：关着的时候也要**说出来**。默默什么都不做，和"扫了但什么都没标出来"
    // 在屏幕上长得一模一样 —— 那正是 D44 要根除的那种沉默。
    status: autoScanInitial ? "idle" : "off",
    count: isPhraseScan(source.phrases) ? source.phrases.items.length : 0,
  });
  /** 自动标词的开关（D45，默认关）。ref 给 openPanel 用 —— 那里读 state 会读到旧闭包 */
  const [autoScan, setAutoScan] = useState(autoScanInitial);
  const autoScanRef = useRef(autoScanInitial);
  /** D42：内容不是他母语、又没问过 —— 有值时面板上弹那一句问询。答完即定 */
  const [needTargetLang, setNeedTargetLang] = useState("");
  /** 已收进词库的：词组原文 → atom id（取消勾选要用 id） */
  const [savedMap, setSavedMap] = useState<Map<string, string>>(
    () => new Map(savedAtoms.map((a) => [a.term, a.id])),
  );
  const scanTriedRef = useRef(false);
  const scanRunningRef = useRef(false);
  /** 刚收下的词，解释取到哪一步了（`词 → 状态`）。只活在这一次观看里，不落库 */
  const [glosses, setGlosses] = useState<Map<string, GlossState>>(() => new Map());
  const savedRef = useRef(savedMap);
  useEffect(() => {
    savedRef.current = savedMap;
  }, [savedMap]);
  /**
   * M3.11 悬浮词卡：**全页只有这一份状态**（性能红线）。
   * 字幕列表每 250ms 跟着当前行重渲染，要是每行各揣一个气泡 state，手机会烫。
   */
  const atomIdOf = useCallback((term: string) => {
    const id = savedRef.current.get(term);
    // temp- 开头的是乐观更新占位，还没真落库 —— 拿它去查会 404
    return id && !id.startsWith("temp-") ? id : undefined;
  }, []);
  const lookup = useWordLookup({ sourceId: source.id, atomIdOf });

  const videoWrapRef = useRef<HTMLDivElement>(null);

  // ── M3.12 片 b：可拖中缝（D47 §B / §B2） ──────────────────────────────
  //
  // **比例不进 React state。** 拖动时每帧 setState 会把整棵树连播放器一起重渲染
  // （M0.5 栽过的那个坑），所以只有一个 CSS 变量在动：`--split-video`。
  // React 这边只有「正在拖吗」一个布尔值，一次拖动总共 setState 两次。
  const gridRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const handleElRef = useRef<HTMLDivElement>(null);
  const splitKind = splitKindOf(source.kind);
  const defaultSplit = SPLIT_DEFAULT[splitKind];
  /**
   * 这一栏的**高度会不会跟着宽度长**（决定要不要那条高度上限）。
   *
   * ⚠️ **偏离冻结计划 §B2 的一条**：计划写的是"高度上限那条对播客按 1:1（封面）算"，
   * 前提是播客左边有一张方形封面。**实际的 `PodcastPlayer` 里根本没有封面** ——
   * 它是一张固定高度约 137px 的控制卡（播放键 + 时间 + 进度条），高度和宽度无关。
   * 照 1:1 算的后果实测过：1512×859 上把播客左栏从该有的 652px 硬压到 585px，
   * 底下空着 465px —— **凭空缩小，一点道理都没有**。所以播客不设上限。
   */
  const capsHeight = source.kind === "youtube";
  const splitRef = useRef(defaultSplit);
  /** 量出来的高度上限（px）。0 = 还没量到（窄屏 / 首帧），那时用 CSS 里那个估算兜底 */
  const capRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const applySplit = useCallback((pct: number) => {
    splitRef.current = pct;
    gridRef.current?.style.setProperty("--split-video", `${pct}%`);
    handleElRef.current?.setAttribute("aria-valuenow", String(Math.round(pct)));
  }, []);

  /**
   * 这一刻中缝最右能到哪儿：78% 与**高度上限换算成的百分比**取小的那个。
   *
   * 为什么要拿上限来夹：窗口一矮，上限就先于 78% 生效，缝停在上限那儿不动了。
   * 若不夹这一下，指针在右、缝在左，看起来像"拖不动"，而**存下去的还是那个
   * 在这个窗口里根本实现不了的数** —— 下次进来照样卡在上限上。夹住之后
   * **缝永远跟在指针底下**，存的也永远是眼睛看到的那个数。
   */
  const maxSplitNow = useCallback((gridW: number) => {
    if (capRef.current <= 0 || gridW <= 0) return SPLIT_MAX;
    const capPct = (capRef.current / gridW) * 100;
    return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, capPct));
  }, []);

  const clampSplit = useCallback(
    (pct: number, gridW: number) => Math.max(SPLIT_MIN, Math.min(maxSplitNow(gridW), pct)),
    [maxSplitNow],
  );

  /** 拖到某个横坐标。只读 DOM、只写 CSS 变量，全程不碰 state */
  const dragTo = useCallback(
    (clientX: number) => {
      const r = gridRef.current?.getBoundingClientRect();
      if (!r || r.width <= 0) return;
      applySplit(clampSplit(((clientX - r.left) / r.width) * 100, r.width));
    },
    [applySplit, clampSplit],
  );

  const commitSplit = useCallback(() => {
    writeSplit(splitKind, splitRef.current);
  }, [splitKind]);

  /** 双击复位（D47 §B）。回默认值并存下来 —— 不然刷新一下又回到刚才拖歪的位置 */
  const resetSplit = useCallback(() => {
    const r = gridRef.current?.getBoundingClientRect();
    applySplit(clampSplit(defaultSplit, r?.width ?? 0));
    writeSplit(splitKind, defaultSplit);
  }, [applySplit, clampSplit, defaultSplit, splitKind]);

  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Home") {
        e.preventDefault();
        resetSplit();
        return;
      }
      const delta = e.key === "ArrowLeft" ? -SPLIT_STEP : e.key === "ArrowRight" ? SPLIT_STEP : 0;
      if (!delta) return;
      e.preventDefault();
      const r = gridRef.current?.getBoundingClientRect();
      const next = clampSplit(splitRef.current + delta, r?.width ?? 0);
      applySplit(next);
      writeSplit(splitKind, next);
    },
    [applySplit, clampSplit, resetSplit, splitKind],
  );

  // 上次拖到哪儿就从哪儿开始。**在 effect 里直改 DOM，不 setState** ——
  // 服务端渲染不出 localStorage，走 state 就是一次必然的水合不一致。
  useEffect(() => {
    const stored = readSplit(splitKind);
    if (stored != null) applySplit(stored);
  }, [splitKind, applySplit]);

  /**
   * 按住缝开始拖。监听挂在 **window** 上而不是那条缝上 —— 指针一动就滑出那 24px 了。
   *
   * 挂载与拆除都在这个函数里就地做完（不走 `useEffect` + state）：
   * 一次拖动只有"越过门槛"和"松手"两次 setState，而且那两次都只影响遮罩和线的颜色。
   * 拆到一半就卸载的情况由下面那个 effect 兜底。
   */
  const teardownDragRef = useRef<(() => void) | null>(null);
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      // 只认主键。右键 / 中键按下去不该开始拖
      if (e.pointerType === "mouse" && e.button !== 0) return;
      teardownDragRef.current?.();
      const startX = e.clientX;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (!moved) {
          if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
          moved = true;
          setDragging(true); // 真的动了才盖遮罩 —— 见 DRAG_THRESHOLD_PX 上的说明
        }
        dragTo(ev.clientX);
      };
      const stop = () => {
        teardownDragRef.current?.();
        if (!moved) return; // 只是点了一下（多半是双击的前半程），什么都别改、更别存
        setDragging(false);
        commitSplit();
      };
      const teardown = () => {
        teardownDragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      teardownDragRef.current = teardown;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [dragTo, commitSplit],
  );
  // 拖到一半整页被换掉（返回 / 换片）：把监听收干净，别留一个指向已卸载组件的闭包
  useEffect(() => () => teardownDragRef.current?.(), []);

  // ── 台面底缘：沉浸磨砂层和暂停面板的上边缘，两个浮层共用同一个值（所以只量一次） ──
  //
  // **只允许落在两条「缝」上，中间一律不许**：
  //   ① 状态卡下边缘（默认）—— 时间进度 / 倍速 / ±N 秒全露在外面，照常能点
  //   ② 视频下边缘（窗口太矮时的退路）—— 整张状态卡被盖住，但**不切开任何一个控件**
  // 落在两条缝之间就是 2026-08-05 创始人截图里那个样子：±10 秒那排按钮被切成两半。
  //
  // 为什么默认留整张卡而不是只留时间（他本人拍的板）：**沉浸聊天里 ±N 秒是真有用的** ——
  // `atS` 在按发送那一刻才取播放头（immersive-chat.tsx 的 send），跳完再问，
  // AI 换的就是那一段的字幕。按钮够不着，这条路等于不存在。
  //
  // ⚠️ 原来磨砂层锚的是**视频底缘**，状态卡整个被盖住；而磨砂顶上那 34px 是透明过渡带
  // （design §4），状态卡正好从带子里透出来、和歌词流第一行叠在一起 —— 那就是他看到的"乱"。
  const stageRef = useRef<HTMLDivElement>(null);
  const [layerTop, setLayerTop] = useState(0);
  useEffect(() => {
    // 退到缝②的门槛：留给浮层的高度低于这个数就不值当了（1280×620 上按缝① 只剩 93px）。
    // 300 是量出来的：他那台 1512×859 按缝① 还有 332px，够，不会被这条退路误伤。
    const MIN_LAYER_H = 300;

    /**
     * 片 b：**把片 a 借来的那个估算常数换成量出来的真值**（D47 账二）。
     *
     * 片 a 写的是 `max-w-[calc((100dvh-20rem)*16/9)]` —— 20rem 是"页头 + 状态卡 +
     * 点点条 + 各处间距 + 母语猜测横幅"的**估算**，而这几样东西的高度随语言、
     * 随字号、随横幅在不在**天天变**。估小了点点条被剪掉，估大了视频白白变小。
     * 现在直接量：视频上面剩多少、下面占多少，一减就是它能有多高。
     *
     * 换成 grid 轨道之后还顺带解决了片 a 欠的另一笔账：上限生效时**多出来的宽度
     * 归右栏**（轨道自己变窄，`1fr` 吃掉剩下的），不再是左栏里一块白留白。
     */
    const measureCap = () => {
      const grid = gridRef.current;
      const wrap = videoWrapRef.current;
      // 窄屏不分栏，这条上限没有意义 —— 而且那时页面是滚的，量出来的数是错的。
      // 播客那一档压根没有"高度跟着宽度长"这回事（见 capsHeight），也就没有上限可言。
      if (!grid || !wrap || !capsHeight || window.innerWidth < LG_PX) return;
      const w = wrap.getBoundingClientRect();
      // 视频**上面**的（页头 + 母语猜测横幅 + main 上内边距）和**下面**的（状态卡 + 点点条 + 两道间距）。
      // 两个都是"和视频多宽无关"的量，所以「量 → 写 → 回流 → 再量」会一步收敛，不会来回荡。
      const above = Math.max(0, w.top);
      // ⚠️ **不能拿左栏自己的 bottom 当"下面"**（第一版就是这么写的，读数看着还挺像那么回事）：
      // 左栏是 grid 子项，默认 `align-items: stretch`，**它的高度永远等于整行的高度**，
      // 跟里面装了什么无关。于是 `col.bottom - video.bottom` 量的其实是"视频底下的空白"，
      // 而那块空白又是视频高度的函数 —— 整个式子变成自指，收敛到一个**看起来合理、
      // 其实毫无意义的不动点**（1512×859 上算出 712px，比真值 1040px 小了三成）。
      // 只有逐个量视频后面那几个**真实兄弟节点**才是"下面到底占了多少"。
      let below = 0;
      for (let el = wrap.nextElementSibling; el; el = el.nextElementSibling) {
        below = Math.max(below, el.getBoundingClientRect().bottom - w.bottom);
      }
      const room = window.innerHeight - above - Math.max(0, below) - CAP_SPARE_PX;
      const next = Math.max(CAP_FLOOR_PX, Math.round((room * 16) / 9));
      if (Math.abs(next - capRef.current) < CAP_EPSILON_PX) return;
      capRef.current = next;
      grid.style.setProperty("--video-cap", `${next}px`);
      // 上限收紧之后，存着的比例可能已经越界了 —— 把缝拉回它现在能到的地方，
      // **但不回写 localStorage**：窗口只是暂时矮了，他调好的那个数得留着。
      const gw = grid.getBoundingClientRect().width;
      const clamped = clampSplit(splitRef.current, gw);
      if (Math.abs(clamped - splitRef.current) > 0.5) applySplit(clamped);
    };

    const measure = () => {
      measureCap();
      const card = stageRef.current?.getBoundingClientRect();
      const video = videoWrapRef.current?.getBoundingClientRect();
      if (!card) return;
      const vh = window.innerHeight;
      const seamCard = Math.max(0, Math.round(card.bottom));
      const seamVideo = video ? Math.max(0, Math.round(video.bottom)) : seamCard;
      const seam = vh - seamCard >= MIN_LAYER_H ? seamCard : seamVideo;
      // 兜底：**手机横屏（844×390）连视频本身都比窗口高**，两条缝全在屏幕外面，
      // 不夹一下浮层高度会算成负数 —— 面板当场变 0 高、完全看不见。
      // 到这一步只能认了盖住一部分视频（D18 让位），但**看不见的面板比盖住的面板更糟**。
      setLayerTop(Math.min(seam, Math.max(0, vh - 160)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stageRef.current) ro.observe(stageRef.current);
    // 左栏也要盯着：拖中缝会改它的宽 → 视频高跟着变 → 台面底缘和高度上限都得重算
    if (leftColRef.current) ro.observe(leftColRef.current);
    window.addEventListener("resize", measure);
    // 播放器加载 / 手机地址栏收放都会引起回流，兜底轮询一小会儿
    const t = window.setInterval(measure, 400);
    const stop = window.setTimeout(() => window.clearInterval(t), 4000);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, [capsHeight, applySplit, clampSplit]);

  // 服务端数据变了（router.refresh 之后）就跟着换。渲染期校正，不用 effect
  const [seen, setSeen] = useState(interrupts);
  if (interrupts !== seen) {
    setSeen(interrupts);
    setPoints(interrupts);
  }

  // 删除失败要回滚到"删之前"，但 handleDelete 得保持稳定身份（点点条按 props 记回调），
  // 所以快照走 ref 而不是把 points 塞进依赖数组
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  const handleReady = useCallback((handle: PlayerHandle) => {
    handleRef.current = handle;
    // M3.6：带着 ?t= 进来的，就绪的第一件事就是把播放头放到那一秒。
    // 不自动播放 —— 跳到位置和"替他按播放"是两回事（D18 那条克制的延长线）。
    const t = startAtRef.current;
    if (t != null && t > 0) {
      startAtRef.current = null;
      handle.seekTo(t);
      currentTimeRef.current = t;
      if (clockRef.current) clockRef.current.textContent = mmss(t);
    }
    // 播放器每次就绪都把用户选的倍速重设一遍 —— 它自己不记，默认永远是 1
    if (rateRef.current !== 1) handle.setRate(rateRef.current);
  }, []);

  /**
   * M3.6：记下"这条内容什么时候被看的"（迁移 0007）。
   * 在这之前库里只有 last_position_s（看到第几秒），**没有任何字段记得什么时候看的** ——
   * 「历史与知识库」按观看日期分组要的就是它。
   *
   * 时机：**第一次真正播放**。不是打开页面就写 —— 点进来看了一眼标题就退，那不叫看过。
   * 计次：同一天再看不 +1（拖两下进度条就写成"看过 40 次"是荒唐的）。
   * 判据在客户端算，因为"今天"是**看的人所在时区**的今天，服务端在 UTC 上算不准。
   */
  const markWatched = useCallback(() => {
    if (watchedSentRef.current) return;
    watchedSentRef.current = true;
    const lastDay = source.last_watched_at
      ? new Date(source.last_watched_at).setHours(0, 0, 0, 0)
      : null;
    const newDay = lastDay == null || lastDay !== new Date().setHours(0, 0, 0, 0);
    void fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watched: true, countsAsNewWatch: newDay }),
    }).catch(() => {
      // 迁移 0007 还没跑、或网络抽风：下一次播放再试。写不上不影响看视频
      watchedSentRef.current = false;
    });
  }, [source.id, source.last_watched_at]);

  /** 回写"看到第几秒"。keepalive：页面正在被关掉时请求也能发出去 */
  const savePosition = useCallback(
    (keepalive = false) => {
      const t = currentTimeRef.current;
      if (t < 1) return;
      if (Math.abs(t - lastSavedValueRef.current) < 1) return;
      lastSavedValueRef.current = t;
      lastSavedAtRef.current = Date.now();
      void fetch(`/api/sources/${source.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastPositionS: t }),
        keepalive,
      }).catch(() => {
        // 存不上不影响观看，下一轮再试
      });
    },
    [source.id],
  );

  const handlePlayingChange = useCallback(
    (next: boolean) => {
      playingRef.current = next;
      // 这条内容**这一次进来有没有真的播出过画面**。±N 秒要靠它把自己拦住 —— 见 seekBy
      if (next && !started) setStarted(true);
      setPlaying(next);
      // 真播起来了才算"看过这条"（M3.6 观看历史）
      if (next) markWatched();
      // 暂停的那一刻是最该记住的位置
      if (!next) savePosition();
    },
    [savePosition, markWatched, started],
  );

  /**
   * M3.7 / D40 —— **懒触发**整片扫词组：第一次在这片子里暂停时后台跑一次，
   * 不看的片子一分钱不花。服务端已经扫过就原样返回（不重复计费）。
   *
   * 全程静默失败：扫不出来只是没有高亮，**面板照常能问、视频照常能看** ——
   * 词库这一片不许把观看页拖下水。
   */
  const ensurePhrases = useCallback(
    async (force = false) => {
      if (scanRunningRef.current) return;
      if (scanTriedRef.current && !force) return;
      scanTriedRef.current = true;
      scanRunningRef.current = true;
      setScanState((s) => ({ ...s, status: "scanning" }));
      let outcome: (typeof scanState)["status"] = "failed";
      let count = 0;
      try {
        // 长内容一轮扫不完（服务端有 150 秒软预算），最多接力 3 轮
        for (let round = 0; round < 3; round++) {
          const res = await fetch("/api/phrases", {
            method: "POST",
            headers: { "content-type": "application/json" },
            // force 只在用户按「再扫一次」时为真 —— 破锁 + 从头重扫，是花钱的动作
            body: JSON.stringify({ sourceId: source.id, force: force || undefined }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) break; // outcome 留在 failed
          if (body.status === "need-target") {
            setNeedTargetLang(String(body.contentLang ?? ""));
            outcome = "idle"; // 等他答完那一句再扫，这不算失败
            break;
          }
          if (isPhraseScan(body.phrases)) {
            setScan(body.phrases);
            count = body.phrases.items.length;
          }
          if (body.status === "not-ready" || body.status === "running") {
            outcome = body.status;
            break;
          }
          if (body.status !== "partial") {
            // 扫完了。**一个都没标出来要单独说** —— 它和"没扫"长得一样，但原因完全不同
            outcome = count > 0 ? "ready" : "empty";
            break;
          }
          // partial：预算用完了，下一轮接着扫
          outcome = count > 0 ? "ready" : "empty";
        }
      } catch {
        // 网络抽风：outcome 留在 failed，界面会给一个「再扫一次」
      } finally {
        scanRunningRef.current = false;
        setScanState({ status: outcome, count });
      }
    },
    [source.id],
  );

  /**
   * 这份扫描是不是按**旧的语言设置**扫的（M3.9，创始人 2026-08-02 反馈）。
   *
   * 他把母语改回简体中文之后，**找不到任何重扫的入口** —— 「再扫一次」只在
   * empty / failed / running 时出现，而他那份是 `ready`。于是一份按错的语言扫出来的
   * 结果就永远钉死在那儿了。现在语言对不上时也给按钮，并**说清楚为什么给**。
   */
  const drift = scan ? scanDrift(scan, prefs, source.content_lang) : "";

  /**
   * 自动标词的开 / 关（D45，创始人 2026-08-02：「做一个按钮，默认关闭，点击后打开就开始运行」）。
   *
   * **开** = 存进偏好 + **当场就把这一片扫了**（他要的就是"点开就跑"，不是"下次进来才跑"）。
   * **关** = 只是不再自动跑；**已经标出来的一个都不删** —— 存在 `sources.phrases` 里的照旧高亮、
   * 照旧能收。花过的钱不该因为关了个开关就白花。
   */
  const toggleAutoScan = useCallback(() => {
    const next = !autoScanRef.current;
    autoScanRef.current = next;
    setAutoScan(next);
    void putSettings({ autoScan: next });
    if (next) {
      scanTriedRef.current = false;
      void ensurePhrases();
    } else {
      // 关了就把那一行退回"关着"，别让它继续显示上一次的结局
      setScanState((s) => ({ ...s, status: "off" }));
    }
  }, [ensurePhrases]);

  /** 用户按「再扫一次」：破锁 + 从头重扫。**花钱的动作，只由人触发** */
  const rescan = useCallback(() => {
    scanTriedRef.current = false;
    void ensurePhrases(true);
  }, [ensurePhrases]);

  /** D42 那一句问询的答案。答完立刻存，并接着把这条内容按正确的模式扫一遍 */
  const answerTarget = useCallback(
    (learn: boolean) => {
      const value = learn ? needTargetLang : ""; // "" = 问过了、不学语言（和"没问过"分得开）
      setNeedTargetLang("");
      void putSettings({ targetLang: value }).then(() => {
        scanTriedRef.current = false;
        void ensurePhrases(true);
      });
    },
    [needTargetLang, ensurePhrases],
  );

  /**
   * 勾 / 取消勾一个词组。乐观更新 —— 打勾要立刻有反应，落库慢一拍不该让人等。
   * 失败就回滚，别让一个假的实心勾骗人说"已经收进去了"。
   */
  /**
   * 去要一句解释，并把「在查 / 查到了 / 没查到」如实挂在界面上。
   *
   * 2026-08-04 真机反馈的病根就在这儿：上一版是 `void fetch(...).catch(() => {})` ——
   * **成功也不说、失败也不说**，他点完词只看见一片安静，自然会以为"这功能没做"。
   * 探针证明解释本来就生成得出来，错的是没人把它端到他眼前。
   */
  const fetchGloss = useCallback(async (term: string, atomId: string) => {
    setGlosses((prev) => new Map(prev).set(term, { status: "busy", text: "" }));
    try {
      const res = await fetch(`/api/atoms/${atomId}/gloss`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      const gloss = typeof body?.atom?.gloss === "string" ? body.atom.gloss : "";
      if (!res.ok || !gloss) throw new Error("no gloss");
      setGlosses((prev) => new Map(prev).set(term, { status: "ready", text: gloss }));
    } catch {
      setGlosses((prev) => new Map(prev).set(term, { status: "failed", text: "" }));
    }
  }, []);

  /** 没查到时人点的重试。**代码永远不自动重来**（D44：花钱只由人点） */
  const retryGloss = useCallback(
    (term: string) => {
      const atomId = savedRef.current.get(term);
      if (!atomId || atomId.startsWith("temp-")) return;
      void fetchGloss(term, atomId);
    },
    [fetchGloss],
  );

  const toggleTerm = useCallback(
    async (phrase: PhraseItem) => {
      const existingId = savedRef.current.get(phrase.text);
      if (existingId) {
        setSavedMap((prev) => {
          const next = new Map(prev);
          next.delete(phrase.text);
          return next;
        });
        // 词都去掉了，那条解释也别再挂在字幕下面
        setGlosses((prev) => {
          if (!prev.has(phrase.text)) return prev;
          const next = new Map(prev);
          next.delete(phrase.text);
          return next;
        });
        try {
          const res = await fetch(`/api/atoms/${existingId}`, { method: "DELETE" });
          if (!res.ok) throw new Error("delete failed");
        } catch {
          setSavedMap((prev) => new Map(prev).set(phrase.text, existingId));
        }
        return;
      }

      const temp = `temp-${Date.now()}`;
      setSavedMap((prev) => new Map(prev).set(phrase.text, temp));
      // **立刻挂上「在查」**，别等落库那一趟回来才开口。手动划的词从点下去到
      // atom 存成有小半秒，那半秒里界面一声不吭 —— 而"一声不吭"正是 2026-08-04
      // 真机反馈的病根（他的原话：「我并没有看到中文解释」）
      if (!phrase.gloss) {
        setGlosses((prev) => new Map(prev).set(phrase.text, { status: "busy", text: "" }));
      }
      try {
        const res = await fetch("/api/atoms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceId: source.id,
            term: phrase.text,
            gloss: phrase.gloss,
            // 它出现的那句原话 —— 复习时光看一个孤零零的词组是想不起来的
            contextQuote: segmentsRef.current[phrase.i]?.text ?? "",
            tS: phrase.t,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.atom?.id) throw new Error("save failed");
        setSavedMap((prev) => new Map(prev).set(phrase.text, String(body.atom.id)));

        // M3.10 / D45：手动划下来的没有解释（AI 标的是扫描时顺手生成的）。
        // **先存后补**：词已经在库里了，这一步只是给它补一句话。
        // 三种结局都会如实挂在他刚点的那一行下面（D44），花钱的重试只由人点。
        // `existed` = 这条词库里本来就有（`POST /api/atoms` 的去重）。
        // 那就别再要一次解释了 —— 这一步花钱，只该为**新收进来的**那条花
        if (!phrase.gloss && body.existed !== true) {
          void fetchGloss(phrase.text, String(body.atom.id));
        } else {
          setGlosses((prev) => {
            if (!prev.has(phrase.text)) return prev;
            const next = new Map(prev);
            next.delete(phrase.text);
            return next;
          });
        }
      } catch {
        setSavedMap((prev) => {
          const next = new Map(prev);
          if (next.get(phrase.text) === temp) next.delete(phrase.text);
          return next;
        });
        // 词根本没存进去，那条「在查…」不能一直转下去
        setGlosses((prev) => {
          if (!prev.has(phrase.text)) return prev;
          const next = new Map(prev);
          next.delete(phrase.text);
          return next;
        });
      }
    },
    [source.id, fetchGloss],
  );

  const postInterrupt = useCallback(
    async (tS: number, mode: QuestionMode | null): Promise<PausePoint> => {
      const res = await fetch("/api/interrupts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, tS, questionMode: mode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "没记下来，请重试");
      return body as PausePoint;
    },
    [source.id],
  );

  // ── 打断面板的开关 ──
  // capture=true（点球）：开面板同时把这一刻记下来（乐观先画点，落库回来换真 id）。
  // capture=false（暂停）：先开面板不落库 —— 用户可能只是停下想想，真问了再记（handleAsk）。
  const openPanel = useCallback(
    (tS: number, capture: boolean) => {
      // 同步置位：紧接着的 pause 回调靠它判断"这是我们自己按停的"
      panelOpenRef.current = true;
      panelTSRef.current = tS;
      if (playingRef.current) {
        resumeOnCloseRef.current = true;
        handleRef.current?.pause();
      } else {
        resumeOnCloseRef.current = false;
      }
      setAsk({ asking: false, answer: "", error: "" }); // 新一轮问答，清掉上次答案
      setPanel({ open: true, tS, id: null, captured: capture });
      // D40 懒触发：**第一次在这片子里停下来**才去扫词组。打开页面就扫等于替他花钱。
      // D45（2026-08-02）：而且**默认根本不扫** —— 自动标词降级成一个默认关着的开关，
      // 他自己按下「开」才跑。一个已经不是主路径的功能，不该还在背后自己花钱。
      if (autoScanRef.current) void ensurePhrases();

      if (capture) {
        const tempId = `temp-${Date.now()}`;
        setPoints((prev) => [
          ...prev,
          { id: tempId, t_s: tS, question_mode: null, question: null, ai_answer: null },
        ]);
        // 落库做成 promise，handleAsk 直接 await —— 避免"点球刚开面板就问"重复落库
        panelIdRef.current = postInterrupt(tS, null)
          .then((saved) => {
            setPoints((prev) => prev.map((p) => (p.id === tempId ? saved : p)));
            setPanel((p) => (p.open && p.id === null ? { ...p, id: saved.id } : p));
            return saved.id;
          })
          .catch(() => {
            setPoints((prev) => prev.filter((p) => p.id !== tempId)); // 没存上撤掉假点
            return null;
          });
      } else {
        panelIdRef.current = null; // 还没落库，等真问了再记
      }
    },
    [postInterrupt, ensurePhrases],
  );

  const closePanel = useCallback(() => {
    panelOpenRef.current = false;
    setPanel((p) => ({ ...p, open: false }));
    if (resumeOnCloseRef.current) {
      resumeOnCloseRef.current = false;
      handleRef.current?.play();
    }
  }, []);

  // ── 长问答沉浸聊天 进/出（design §B/C/E） ──
  // 进入：视频先冻结（暂停）；关掉可能开着的短问答面板但**不**触发它的续播。
  // 顺序要紧：immersiveRef 必须在 pause() 之前置位（pause 会触发 onPause→handlePause）。
  const enterImmersive = useCallback(() => {
    immersiveRef.current = true;
    panelOpenRef.current = false;
    resumeOnCloseRef.current = false;
    setPanel((p) => ({ ...p, open: false }));
    handleRef.current?.pause();
    setImmersive(true);
  }, []);
  // 退出：不自动播放，保留进入时的暂停状态（design §E.4）。退出 compact 在沉浸层卸载时跑。
  const exitImmersive = useCallback(() => {
    immersiveRef.current = false;
    setImmersive(false);
  }, []);

  /** 用户真的按了暂停（缓冲/播放结束不算，见 PlayerProps.onPause） */
  const handlePause = useCallback(() => {
    if (panelOpenRef.current || immersiveRef.current) return; // 面板已开 / 沉浸态：不弹短问答面板
    openPanel(currentTimeRef.current, false);
  }, [openPanel]);

  /** 轻点悬浮球 = 记下这一刻并开面板 */
  const captureNow = useCallback(() => {
    openPanel(currentTimeRef.current, true);
  }, [openPanel]);

  /** 问一句：确保这刻已落库（拿到 interruptId）→ 流式取 /api/ask，边收边显示 */
  const handleAsk = useCallback(
    async (question: string) => {
      setAsk({ asking: true, answer: "", error: "" });
      try {
        // 点球开的面板已经在落库（await 那个 promise）；暂停开的还没落库，这会儿才记（标 free）
        let idPromise = panelIdRef.current;
        if (!idPromise) {
          idPromise = postInterrupt(panelTSRef.current, "free")
            .then((saved) => {
              setPoints((prev) => [...prev, saved]);
              setPanel((p) => (p.open && p.id === null ? { ...p, id: saved.id, captured: true } : p));
              return saved.id;
            })
            .catch(() => null);
          panelIdRef.current = idPromise;
        }
        const id = await idPromise;
        if (!id) throw new Error("没记下这一刻，稍后再问一次");

        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ interruptId: id, question }),
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? "没答出来，稍后再试");
        }

        // NDJSON：chunk 逐块拼、done 收尾、error 报错
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let streamErr = "";
        // 收全的答案。除了上屏，M3.5 还要拿它就地更新那个暂停点 —— 不然刚问完的这一条
        // 在回看列表里还写着「只是停了一下」，得刷新页面才对得上
        let fullAnswer = "";
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
              const piece = ev.text;
              fullAnswer += piece;
              setAsk((a) => ({ ...a, answer: a.answer + piece }));
            } else if (ev.type === "done") {
              const full = ev.answer;
              if (full) fullAnswer = full;
              setAsk((a) => ({ asking: false, answer: full ?? a.answer, error: "" }));
            } else if (ev.type === "error") {
              streamErr = ev.message ?? "没答出来，稍后再试";
            }
          }
        }
        if (streamErr) {
          setAsk({ asking: false, answer: "", error: streamErr });
        } else {
          setAsk((a) => (a.asking ? { ...a, asking: false } : a));
          // 服务端答完整了才落库（/api/ask），这里跟着把本地那一行补齐，口径保持一致
          if (fullAnswer.trim()) {
            setPoints((prev) =>
              prev.map((p) =>
                p.id === id
                  ? {
                      ...p,
                      question,
                      ai_answer: fullAnswer,
                      question_mode: p.question_mode ?? "free",
                    }
                  : p,
              ),
            );
          }
        }
      } catch (e) {
        setAsk({
          asking: false,
          answer: "",
          error: e instanceof Error ? e.message : "没答出来，稍后再试",
        });
      }
    },
    [postInterrupt],
  );

  /** 不问，只把这一刻记下来（暂停触发、还没落库时的入口） */
  async function handleJustCapture() {
    const saved = await postInterrupt(panelTSRef.current, null);
    setPoints((prev) => [...prev, saved]);
    closePanel();
  }

  const handleSeek = useCallback((t: number) => {
    handleRef.current?.seekTo(t);
    // 立刻把"现在在哪"改过来，别等下一次 250ms 轮询。
    // 否则连点两下点点条的「下一个」会卡在原地 —— 第二下读到的还是旧位置。
    currentTimeRef.current = t;
    if (clockRef.current) clockRef.current.textContent = mmss(t);
  }, []);

  /**
   * ±N 秒。夹在 [0, 时长) 里 —— 往前跳过头会让 YouTube 直接判"播完了"。
   *
   * ⚠️ **视频还没播过就不许跳**（创始人 2026-08-02 报「视频播放都是黑色的」，已复现）：
   * `seekTo()` 打在一个"已载入但一次都没播过"的 YouTube 播放器上，会**把封面图掀掉**，
   * 而它又没法在没有 iframe 内手势的情况下自己播起来 —— 结果就是**一整块黑的**，
   * 而且回不去（封面图不会再回来）。复现边界很干净：正在播的时候跳，一切正常；
   * 从没播过的时候跳，必黑。
   * 所以这里直接拦住，按钮那边同步变灰并写明"先播起来"，**不做静默的空动作**（D44）。
   */
  const seekBy = useCallback(
    (deltaS: number) => {
      const handle = handleRef.current;
      if (!handle) return;
      if (!started && source.kind === "youtube") return;
      const duration = handle.getDuration();
      const raw = (handle.getCurrentTime() || currentTimeRef.current) + deltaS;
      const ceiling = duration > 0 ? Math.max(0, duration - 0.5) : raw;
      handleSeek(Math.max(0, Math.min(ceiling, raw)));
    },
    [handleSeek, started, source.kind],
  );

  /** 换倍速：先落到播放器，再记进偏好（换台设备也是这个速度） */
  const changeRate = useCallback((next: number) => {
    rateRef.current = next;
    shownRateRef.current = next;
    setRate(next);
    handleRef.current?.setRate(next);
    void putSettings({ playRate: next });
  }, []);

  const changeStep = useCallback((next: number) => {
    setSkipStep(next);
    void putSettings({ skipStep: next });
  }, []);

  /** 字幕层自己按 250ms 来取时间。给它 ref 的读法，而不是把秒数灌进 state ——
      灌进去就是每秒 4 次整页重渲染，M0.5 栽过的那个坑 */
  const getCurrentTime = useCallback(() => currentTimeRef.current, []);

  /**
   * M2a：把字幕转出来。服务端回的是 **NDJSON 流** —— 一行一个事件，
   * 转出一块推一块，所以字幕是"长出来"的，不是等到最后一次性砸下来。
   *
   * 落库在服务端那边做，这里只负责显示：中途断了也不丢，重进页面还在。
   */
  const runTranscription = useCallback(async (cacheOnly = false) => {
    if (runningRef.current) return;
    runningRef.current = true;
    // 只查缓存那次是"静默"的：命中就让字幕自己冒出来，没命中什么都不显示，
    // 别闪一下"生成中"再缩回去。真要花钱转时才亮出进度。
    if (!cacheOnly) setGen({ running: true, coveredS: null, error: "" });

    let complete = false;
    let note = "";
    try {
      const res = await fetch("/api/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          // 播放器知道的时长比库里准（YouTube 的 oEmbed 给不了时长）
          durationS: handleRef.current?.getDuration() || undefined,
          cacheOnly: cacheOnly || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "字幕没生成出来，稍后再试");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // NDJSON：按行切，最后一截可能是半行，留给下一轮
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;

          let event: {
            type?: string;
            segments?: TranscriptSegment[];
            coveredS?: number;
            complete?: boolean;
            message?: string;
            note?: string | null;
          };
          try {
            event = JSON.parse(raw);
          } catch {
            continue; // 半行或杂音，跳过就是
          }

          if (event.type === "partial" && event.segments) {
            setTranscript(event.segments);
            segmentsRef.current = event.segments;
            setGen((g) => ({ ...g, coveredS: event.coveredS ?? g.coveredS }));
            setStatus("partial");
          } else if (event.type === "done") {
            if (event.segments) {
              setTranscript(event.segments);
              segmentsRef.current = event.segments;
            }
            complete = Boolean(event.complete);
            setStatus(complete ? "ready" : "partial");
            // 半截停下来是有原因的，别让用户对着不动的字幕自己猜
            if (!complete && event.note) note = event.note;
          } else if (event.type === "error") {
            setStatus("failed");
            throw new Error(event.message ?? "字幕没生成出来");
          }
          // event.type === "miss"：缓存没命中。什么都不做 —— 状态留 pending，
          // 让 YouTube 的「生成字幕」按钮候着，等用户真要花钱时再点。
        }
      }
      if (!cacheOnly) setGen({ running: false, coveredS: null, error: note });
    } catch (e) {
      // 只查缓存那次失败就默默算了（多半是迁移还没跑），别拿红字吓用户
      if (!cacheOnly) {
        setGen({
          running: false,
          coveredS: null,
          error: e instanceof Error ? e.message : "字幕没生成出来，稍后再试",
        });
      }
    } finally {
      runningRef.current = false;
    }
    return complete;
  }, [source.id]);

  useEffect(() => {
    // 没转过的（pending）和转了一半的（partial）都自动接着干 ——
    // 创始人真机撞到的就是这个：转到一半退出页面，再进来它就那么僵着，
    // 得手动去点"继续生成"。**没转完的东西不该等人来催。**
    // 失败的（failed）仍然不自动重来：私享视频那类是永久性失败，
    // 每开一次页面重试一次只是白烧额度再报同一句错。
    if (source.transcript_status !== "pending" && source.transcript_status !== "partial") return;

    let cancelled = false;
    let tries = 0;

    const tick = async () => {
      if (cancelled) return;

      // YouTube 从没转过（pending）：**只免费查一次缓存**（D31）——
      // 别人转过这支就直接白拿、零点击零等待；没人转过就此打住，
      // 等用户按「生成字幕」再花钱走 Gemini。绝不打开就自动烧钱。
      // 缓存检查不需要时长，立刻打。
      if (source.kind === "youtube" && source.transcript_status === "pending") {
        await runTranscription(true);
        return;
      }

      // 其余（YouTube 转了一半要续 / 播客自动转）：这些是真要转的，
      // 先等播放器报真实时长（最多等 5 秒）—— 不知道时长就切不准、也不知何时算转完。
      if (!durationKnownRef.current && tries++ < 10) {
        window.setTimeout(tick, 500);
        return;
      }
      // 一次最多接力 3 轮（服务端每轮有 240 秒软预算）。再长的内容
      // 交给用户按「继续生成」—— 每一按都是真金白银，不该由代码替他连按
      for (let round = 0; round < 3 && !cancelled; round++) {
        const done = await runTranscription(false);
        if (done !== false) break;
      }
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [source.transcript_status, source.kind, runTranscription]);

  /** 1c-fix / D19：删掉一个误点的捕获点。先从条上撤下来，失败再放回去 */
  const handleDelete = useCallback(async (id: string) => {
    const snapshot = pointsRef.current;
    setPoints((prev) => prev.filter((p) => p.id !== id));
    try {
      const res = await fetch(`/api/interrupts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "没删掉，请重试");
      }
    } catch (e) {
      setPoints(snapshot); // 回滚到删之前，别让点凭空消失
      throw e;
    }
  }, []);

  useEffect(() => {
    // 每 250ms 读一次位置。刻意写进 ref + 直改 DOM，不走 setState ——
    // 每秒 4 次 setState 会把整页重渲染，M0.5 已经在这上面栽过一次。
    const timer = window.setInterval(() => {
      const handle = handleRef.current;
      if (!handle) return;

      const t = handle.getCurrentTime();
      currentTimeRef.current = t;
      if (clockRef.current) clockRef.current.textContent = mmss(t);

      const duration = handle.getDuration();
      if (duration > 0 && totalRef.current) totalRef.current.textContent = mmss(duration);

      // 倍速牌子照实说：用户可能在 YouTube 自带的齿轮菜单里改了速度，
      // 我们这块牌子就得跟着改口 —— 写着 1× 却在 1.5× 播，是骗人。
      // **只镜像、不回存偏好**：播放器自己把倍速打回 1 的情况（换片 / 重建）很常见，
      // 那不是用户的意思，存下去等于把他选的速度悄悄抹了。要恢复，点一下就好。
      const actualRate = handle.getRate();
      if (actualRate > 0 && Math.abs(actualRate - shownRateRef.current) > 0.01) {
        shownRateRef.current = actualRate;
        setRate(actualRate);
      }

      // 时长只 setState 一次 —— 点点条要用它算百分比
      if (!durationKnownRef.current && duration > 0) {
        durationKnownRef.current = true;
        setDurationS(duration);
      }

      // 球色（D5）：**这一刻有没有字幕**，而不是"整片转完没有"。
      // 只看 transcript_status 不诚实 —— 字幕才转到第 10 分钟、人已经拖到
      // 第 40 分钟，那儿根本没字幕可用，球不该是青的。
      // 也不能只看"转到第几秒"：并行之后各片乱序回来，中间可能是空的。
      // 只有真去查一下这一刻落没落在某一句上，才算数。
      const segs = segmentsRef.current;
      const i = activeSegmentIndex(segs, t);
      const ready = i >= 0 && segs[i].end >= t - 2;
      if (ready !== orbReadyRef.current) {
        orbReadyRef.current = ready;
        setOrbReady(ready);
      }

      // 时长只回写一次：oEmbed 拿不到，只有播放器就绪后才知道真实秒数
      if (!durationSentRef.current && duration > 0) {
        durationSentRef.current = true;
        void fetch(`/api/sources/${source.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ durationS: duration }),
        }).catch(() => {
          durationSentRef.current = false;
        });
      }

      if (Date.now() - lastSavedAtRef.current > SAVE_EVERY_MS) savePosition();
    }, 250);
    return () => window.clearInterval(timer);
  }, [source.id, savePosition]);

  useEffect(() => {
    // 手机上"离开页面"多半不触发 unload，pagehide + 切后台才是可靠信号
    const onLeave = () => savePosition(true);
    const onHidden = () => {
      if (document.visibilityState === "hidden") savePosition(true);
    };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onHidden);
      savePosition(true);
    };
  }, [savePosition]);

  // M3.7：把扫描结果对齐回**当前**字幕。字幕会变（转到一半会继续长、还能重新粘一份），
  // 下标错位就会把高亮标到别的句子上 —— `resolvePhrases` 逐条校验，对不上的宁可不标。
  // useMemo：字幕层是 250ms 的热路径，这个绝不能每帧重算。
  const highlights = useMemo(() => resolvePhrases(scan, transcript ?? []), [scan, transcript]);
  const savedTerms = useMemo(() => new Set(savedMap.keys()), [savedMap]);

  // D39：面板里那两秒（`[t−2, t]`）。"有重叠即算"，所以拿到的是覆盖那两秒的完整一两句，
  // 不会切半句。纯前端从已加载的字幕里切，不发请求。
  const panelLines: PanelLine[] = useMemo(() => {
    if (!panel.open) return [];
    const segs = transcript ?? [];
    return segmentsInWindow(segs, panel.tS - 2, panel.tS).map((seg) => {
      const i = segs.indexOf(seg);
      const phrase = highlights.get(i);
      return {
        i,
        t: seg.start,
        text: seg.text,
        phrase,
        saved: !!phrase && savedTerms.has(phrase.text),
        // M3.10：手动划下来的词在字幕里没有坐标（AI 标的自带 `start`），只能拿词回来找。
        // 这里只有一两行，`findTerms` 的开销可以忽略
        savedSpans: findTerms(seg.text, savedTerms),
      };
    });
  }, [panel.open, panel.tS, transcript, highlights, savedTerms]);

  if (!shell) {
    return (
      <div className="rounded-2xl border border-ink-700 p-5 text-sm text-ink-300">
        这类内容（{source.kind}）的播放器还没做。
      </div>
    );
  }

  const { Player } = shell;

  return (
    // ── M3.12 片 a：宽屏两栏工作台（D47） ──
    //
    // `lg:` 起（≥1024px）从一根居中的柱子变成 视频左 / 学习右。**判据只认窗口宽度**，
    // 不做设备嗅探 —— UA 不可靠（iPad 在 Safari 里谎报自己是 Mac），而且按宽度走意味着
    // 把窗口拉窄就自动退回手机布局，不用维护两份（D47①）。
    //
    // 窄屏这边**一个像素都没动**：外层仍是 `flex flex-col gap-3`，左右两栏只是两个
    // 中间容器，左栏内部也是 gap-3，所以竖着排下来的间距和以前逐像素一致。
    //
    // 比例走 CSS 变量：片 b 的可拖中缝只改这一个变量，不重排 DOM、更不重渲播放器。
    //
    // 三条轨道 = 左栏 / 中缝 / 右栏，中缝那 1.5rem **就是**两栏之间的沟（所以
    // `lg:gap-x-0`，总沟宽和片 a 的 `gap-x-6` 一样是 24px，只是现在它能拖了）。
    //
    // 左栏轨道是 `min(比例, 高度上限)`：**上限一生效，多出来的宽度自动归右栏**
    // （`1fr` 吃掉剩下的），不再像片 a 那样在左栏里留一块白。
    // `--video-cap` 的初值是片 a 那个 CSS 估算 —— 只活到量尺跑完的那一帧（见 measureCap）。
    <div
      ref={gridRef}
      className="flex flex-col gap-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[min(var(--split-video),var(--video-cap))_1.5rem_1fr] lg:gap-x-0"
      style={
        {
          "--split-video": `${defaultSplit}%`,
          // 播客那一档给一个**永远夹不住**的值（见 capsHeight）
          "--video-cap": capsHeight ? "calc((100dvh - 20rem) * 16 / 9)" : "100%",
        } as React.CSSProperties
      }
    >
      {/* ── 左栏：视频 + 状态卡 + 点点条。**不滚。** ──
          点点条跟视频走，不去右栏（2026-08-05 创始人确认，也是计划 §A 的骨架图）：
          它本质上是**时间轴**，和播放器进度条是同一根 26 分钟 —— 宽度不一致就没有"位置感"，
          同样几个点挤进 38% 的右栏也更难点中。

          ⚠️ 高度上限（账二）现在长在**外层的 grid 轨道**上，不在这个 div 上：
          视频是 16:9，宽度一涨高度跟着涨，桌面真正的天花板是**窗口有多高**而不是多宽。
          不夹这一下，1280×620 这种矮窗口上左栏会比窗口高 49px，点点条直接被
          `overflow-hidden` 剪掉。片 b 已把片 a 那个估算常数换成量出来的真值（measureCap）。*/}
      <div ref={leftColRef} className="flex min-w-0 flex-col gap-3 lg:min-h-0">
        {/* D18：画面越大越好 —— 手机上让播放器顶掉页面左右内边距，整整宽出 40px。
            sm 以上回到圆角卡片（桌面宽度富余，全出血反而失衡） */}
        <div ref={videoWrapRef} className="-mx-5 sm:mx-0">
          <Player
            source={source}
            onReady={handleReady}
            onPlayingChange={handlePlayingChange}
            onPause={handlePause}
          />
        </div>

        {/* 状态卡。它的下边缘就是「台面底缘」—— 沉浸磨砂层和暂停面板都锚在这儿 */}
        <div ref={stageRef} className="rounded-2xl border border-ink-700 px-4 py-2.5">
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`h-2 w-2 rounded-full ${playing ? "bg-teal-400" : "bg-ink-500"}`}
              aria-hidden
            />
            <span className="text-sm text-ink-300">{playing ? "播放中" : "已暂停"}</span>
            <span className="text-xs text-ink-500">
              ·{" "}
              {status === "ready"
                ? "字幕就绪"
                : gen.running
                  ? "字幕生成中"
                  : status === "failed"
                    ? "字幕没生成出来"
                    : status === "partial"
                      ? "字幕生成了一半"
                      : "字幕待生成"}
            </span>
          </div>
          <p className="ui-mono text-sm text-ink-100" aria-label="播放位置">
            <span ref={clockRef}>{source.last_position_s ? mmss(source.last_position_s) : "00:00"}</span>
            <span className="text-ink-500"> / </span>
            <span ref={totalRef} className="text-ink-500">
              {source.duration_s ? mmss(source.duration_s) : "--:--"}
            </span>
          </p>
          </div>

          {/* 倍速 + ±N 秒。挤在同一条胶囊的第二行 —— 不另开一块地（D18） */}
          <PlayerControls
            // 只有 YouTube 嵌入有这个毛病（没播过就 seek → 封面被掀掉、剩一块黑）。
            // 播客是 <audio>，没有封面这一层，没播就跳完全正常 —— 别连坐
            canSeek={started || source.kind !== "youtube"}
            step={skipStep}
            rate={rate}
            onStep={changeStep}
            onRate={changeRate}
            onSeekBy={seekBy}
          />
        </div>

        {/* 点点条：时间轴，所以跟视频同宽、留在左栏（创始人 2026-08-05 确认）。

            M3.6：暂停点回看**列表**已经从这里搬走（D37/D38）—— 创始人真机看过后的
            原话是"就不应该出现在看视频的界面"，它现在的家是 `/library/[id]` 的 tab1。
            这一页只留横着的点点条：看的时候要的是位置感，不是一张清单。 */}
        <DotBar
          points={points}
          durationS={durationS}
          getCurrentTime={getCurrentTime}
          onSeek={handleSeek}
          onDelete={handleDelete}
        />
      </div>

      {/* ── 中缝：按住拖 / 双击复位 / 方向键微调（D47 §B） ──
          命中区是整条 24px 的沟（计划要求 ≥8px），**看得见的只有中间那 1px** ——
          它是两栏之间的沟本身，不是额外占的地。窄屏 `hidden`：那儿根本没有两栏。
          `touch-none` 挡掉浏览器的手势接管（否则触屏笔电上一拖就变成滚页面）。 */}
      <div
        ref={handleElRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整视频与学习区的宽度，双击复位"
        aria-valuemin={SPLIT_MIN}
        aria-valuemax={SPLIT_MAX}
        aria-valuenow={Math.round(defaultSplit)}
        tabIndex={0}
        onPointerDown={startDrag}
        onDoubleClick={resetSplit}
        onKeyDown={onHandleKeyDown}
        className={`group hidden select-none touch-none lg:flex lg:cursor-col-resize lg:items-center lg:justify-center ${
          dragging ? "" : "focus-visible:outline-none"
        }`}
      >
        <span
          aria-hidden
          className={`h-full w-px rounded-full transition-colors ${
            dragging ? "bg-teal-400" : "bg-ink-700 group-hover:bg-teal-400 group-focus-visible:bg-teal-400"
          }`}
        />
      </div>

      {/* ── 右栏：字幕（选词 / 查词的主战场）。**整页只有这一栏会滚。** ──
          `lg:min-h-0` + `lg:overflow-y-auto` 两个一起才成立：grid 子项不写 min-h-0
          就不肯缩到内容以下，overflow 永远触发不了、页面改成整体撑高。 */}
      <div className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        {/* D4：字幕可开关、字号可调、行宽自适应 —— 视频与播客共用同一层 */}
        <CaptionLayer
          sourceId={source.id}
          transcript={transcript}
          kind={source.kind}
          getCurrentTime={getCurrentTime}
          onSeek={handleSeek}
          captionLang={prefs.captionLang}
          highlights={highlights}
          savedTerms={savedTerms}
          onToggleTerm={toggleTerm}
          glosses={glosses}
          onRetryGloss={retryGloss}
          onLookup={lookup.open}
          onLookupLeave={lookup.leave}
          contentLang={source.content_lang}
          autoScan={autoScan}
          onToggleAutoScan={toggleAutoScan}
          scanning={scanState.status === "scanning"}
          generation={{
            running: gen.running,
            coveredS: gen.coveredS,
            totalS: durationS || source.duration_s,
            error: gen.error,
            resumable: status === "partial",
            onRun: () => void runTranscription(),
          }}
        />
      </div>

      {/* 拖中缝时整页盖一层透明遮罩 —— **这一层不是装饰，是拖动能不能成立的前提**（D47 §B）。
          光标一旦掠过 YouTube 的 `<iframe>`，指针事件就被 iframe 内部吞掉，
          window 上的 `pointermove` 当场断供、缝卡在半路。`setPointerCapture` 在部分浏览器
          挡不住跨源 iframe，**盖一层才是可靠解**。松手立刻拆掉（`dragging` 一 false 就卸载）。
          z-[80]：连词卡（z-[70]）都要压住 —— 拖动过程中不该有任何东西还能抢指针。 */}
      {dragging && (
        <ViewportLayer>
          <div className="fixed inset-0 z-[80] cursor-col-resize select-none" aria-hidden />
        </ViewportLayer>
      )}

      {/* 悬浮捕获球。轻点 = 记下这一刻并开面板；长按 = 进/出沉浸聊天。
          M2a：球色接上真状态 —— 灰=这一刻还没字幕，青=这一刻有字幕（D5 的双态色）。
          判据是"盖没盖住当前播放位置"，不是"整片转完没有"。

          ⚠️ 原注释写的「挂在树里即可，位置与页面布局无关」是**错的** —— M3.12 片 a0
          实测：挂在 `<main class="page-enter">` 里，`fixed` 就不再相对视口，
          球按 `window.innerWidth` 算出来的横坐标会再叠一个 main 的左边距，
          1280 宽上直接飞出屏幕。三层都得靠 <ViewportLayer> 搬到 body 底下。 */}
      <ViewportLayer>
        <CaptureOrb
          state={orbReady ? "ready" : "pending"}
          immersive={immersive}
          onTap={captureNow}
          onLongPress={immersive ? exitImmersive : enterImmersive}
        />
      </ViewportLayer>

      <ViewportLayer>
        <InterruptPanel
          open={panel.open}
          stageBottom={layerTop}
          tS={panel.tS}
          captured={panel.captured}
          asking={ask.asking}
          answer={ask.answer}
          askError={ask.error}
          onAsk={handleAsk}
          onJustCapture={handleJustCapture}
          onEnterImmersive={enterImmersive}
          onClose={closePanel}
          lines={panelLines}
          scan={scanState}
          drift={drift}
          onRescan={rescan}
          onToggleTerm={toggleTerm}
          glosses={glosses}
          onRetryGloss={retryGloss}
          onLookup={lookup.open}
          onLookupLeave={lookup.leave}
          contentLang={source.content_lang}
          needTargetLang={needTargetLang}
          onAnswerTarget={answerTarget}
        />
      </ViewportLayer>

      {/* M3.11：悬浮词卡。**整页只有这一个** —— 暂停面板和字幕列表共用它。
          它自己就 portal 到 body（word-bubble.tsx），所以这里不用再裹一层 */}
      {lookup.bubble}

      {immersive && (
        <ViewportLayer>
          <ImmersiveChat
            sourceId={source.id}
            stageBottom={layerTop}
            getCurrentTime={getCurrentTime}
            pauseVideo={() => handleRef.current?.pause()}
            onExit={exitImmersive}
          />
        </ViewportLayer>
      )}
    </div>
  );
}

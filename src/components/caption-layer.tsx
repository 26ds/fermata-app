"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { activeSegmentIndex, parseTranscript } from "@/lib/captions";
import { LayoutPicker } from "@/components/layout-picker";
import { PhraseCheck } from "@/components/phrase-line";
import { SelectableLine, type GlossState } from "@/components/selectable-line";
import { Toggle } from "@/components/toggle";
import { useIsWide } from "@/components/use-wide";
import { ViewportLayer } from "@/components/viewport-layer";
import type { PhraseItem } from "@/lib/phrases/types";
import { normalizeLang, sameLang } from "@/lib/lang";
import { findTerms, type TermSpan } from "@/lib/segment";
import { putSettings } from "@/lib/settings-client";
import { mmss } from "@/lib/time";
import type { TranscriptSegment } from "@/lib/types";
import { TARGET_LANGS } from "@/lib/translate/langs";
import type { LayoutStore, WatchLayout } from "@/lib/watch-layout";
import { useCopy } from "@/components/copy-provider";

// M1d — 字幕层（D4）：开关 + 字号 14–28px（存 localStorage）+ 行宽自适应（.caption-copy）
// + 跟着播放走的高亮。点某一句 = 跳到那一句，跟点点条同一个手感。
//
// M1 阶段字幕靠手贴（.srt / .vtt），目的是**先把渲染与同步验对**；
// M2 的自动转写写同一个字段、同一个形状，这个组件届时一个字都不用改。

/**
 * YouTube 自家「显示转录」的三步点击路径。
 *
 * **抽出来是因为它现在要出现在两个地方**：粘贴框里（点开之后），以及
 * 自动转写走进死路时（点开之前 —— 那时候人最需要它，却最看不见）。
 * 一份文案，别让两处慢慢长歪。
 */
function YoutubeCopySteps() {
  const t = useCopy();

  return (
    <ol className="ml-4 list-decimal space-y-0.5">
      <li>
        {t("cap.ytStep1a")}
        <span className="text-ink-300">{t("cap.ytStep1More")}</span>
        {t("cap.ytStep1b")}
        <span className="text-ink-300">{t("cap.ytStep1Show")}</span>
        {t("cap.ytStep1c")}
      </li>
      <li>
        {t("cap.ytStep2a")} <span className="text-ink-300">{t("cap.ytStep2Copy")}</span>
      </li>
      <li>
        {t("cap.ytStep3a")} <span className="text-ink-300">{t("cap.ytStep3Paste")}</span>{" "}
        {t("cap.ytStep3b")}
      </li>
    </ol>
  );
}

/**
 * M3.15 片 g —— 字幕栏头上那颗齿轮打开的浮层（「AI 标词 / 字号 / 译文」三行，宽屏专用）。
 *
 * 贴着齿轮摆：**下面放得下就往下开，放不下就往上开**（「沉浸 · 窄」里字幕栏在视频下面、离屏幕底很近）。
 * 位置在出生那一帧量（layout effect，看不见"先出现在左上角再跳过去"）；窗口一变、或者外面哪一层一滚，就收起来 ——
 * 跟着挪要一直盯着，收起来再点一下就对了，简单的那条路不会错。
 */
function CaptionSettingsPop({
  anchorRef,
  label,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // 量完**直接写 DOM**，不进 state：layout effect 在浏览器画第一帧之前跑，写进去的位置就是第一帧的位置；
  // 进 state 还得多渲染一轮（本仓库的 lint 也拦「effect 里同步 setState」）
  useLayoutEffect(() => {
    const box = boxRef.current;
    const a = anchorRef.current?.getBoundingClientRect();
    if (!box || !a) return;
    const GAP = 6;
    const below = window.innerHeight - a.bottom - GAP - 8;
    const above = a.top - GAP - 8;
    const need = box.scrollHeight;
    box.style.right = `${Math.max(8, window.innerWidth - a.right)}px`;
    // 下面放得下就往下；都放不下时挑空间大的那边，里面能滚
    if (below >= need || below >= above) {
      box.style.top = `${a.bottom + GAP}px`;
      box.style.maxHeight = `${below}px`;
    } else {
      box.style.bottom = `${window.innerHeight - a.top + GAP}px`;
      box.style.maxHeight = `${above}px`;
    }
  }, [anchorRef]);

  useEffect(() => {
    const bye = (e: Event) => {
      // 浮层自己里面滚（放不下时它能滚）不算
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("resize", bye);
    window.addEventListener("scroll", bye, true);
    return () => {
      window.removeEventListener("resize", bye);
      window.removeEventListener("scroll", bye, true);
    };
  }, [onClose]);

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={label}
      data-caption-settings=""
      className="fixed z-[60] w-[23rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 px-3 pb-3 pt-1 shadow-lg shadow-ink-900/70"
    >
      {children}
    </div>
  );
}

const SIZE_KEY = "fermata.captions.size";
const SIZE_MIN = 14;
const SIZE_MAX = 28;
const SIZE_DEFAULT = 18;
/**
 * M3.15 片 g2 —— ③「沉浸 · 宽」**自己的字号**（计划 §D 第 3 条 / D67：「进③时字号自动上调一档（字号滑块本来就在，他还能自己再调）」）。
 * 「一档」= 4px（计划没写死数，这是我定的：默认 18 → 22px；要改只改 `WIDE_BUMP`）。
 * 在 ③ 里拖滑杆改的是 ③ 这一个（另存一个键）—— 回到 ①② 还是原来的字号，来回切也不会越切越大。
 * 没在 ③ 里调过，就一直是「①② 的字号 + 一档」。
 */
const SIZE_WIDE_KEY = "fermata.captions.sizeWide";
const WIDE_BUMP = 4;

// M2.9 双语字幕的三个偏好。
// **M3.7 / D42：译文语言搬进后台**（`user_settings.captionLang`）—— 存 localStorage
// 意味着换台设备就得重选一次，这是 D42 点名的三处硬伤之一。
// flip（谁大）和"只当前行"留在 localStorage：纯显示口味，不值得占一次网络请求。
const LANG_KEY = "fermata.captions.lang"; // 只剩下"从老版本搬家"这一个用途
const FLIP_KEY = "fermata.captions.flip"; // "1" = 译文大原文小
const TRONLY_KEY = "fermata.captions.tronly"; // "1" = 只在当前行显示译文

// 老版本存在本机的译文语言，读一次就够（搬进后台后这个值再也不用）。
// 走 useSyncExternalStore 而不是 effect：SSR 那一帧拿到 ""，水合完再拿真值，
// 不会"服务端渲染的和客户端第一帧对不上"（本项目 M3.5 起统一用这个套路读本地状态）。
let cachedLegacyLang: string | null = null;
const readLegacyLang = () => {
  if (cachedLegacyLang === null) {
    try {
      cachedLegacyLang = localStorage.getItem(LANG_KEY) ?? "";
    } catch {
      cachedLegacyLang = ""; // 隐私模式：没得搬
    }
  }
  return cachedLegacyLang;
};
const readServerLegacyLang = () => "";
const subscribeNothing = () => () => {};

/** M2a：自动转写的进展。上层（watch-stage）驱动，这里只负责说人话 */
export interface CaptionGeneration {
  /** 正在生成中 */
  running: boolean;
  /** 已经转到第几秒 / 全片多长 —— 用来显示百分比 */
  coveredS: number | null;
  totalS: number | null;
  /** 失败原因（人话）。空字符串 = 没失败 */
  error: string;
  /**
   * 这次失败**重试也没用**（视频不公开 / 地区限制…，服务端分类的，见
   * `isPermanentGeminiFailure`）。true 时「重试」不再当主按钮 —— 换「粘贴字幕」上。
   */
  permanent?: boolean;
  /** 还剩一截没转完（上次被打断），可以接着来 */
  resumable: boolean;
  /** 开始 / 继续 / 重试，都是这一个动作 */
  onRun(): void;
}

interface CaptionLayerProps {
  sourceId: string;
  transcript: TranscriptSegment[] | null;
  /** 内容类型。YouTube 走"粘贴优先"（有 CC 就免费），播客走自动转写 */
  kind?: string;
  /** 现在播到第几秒。热路径 —— 这里自己按 250ms 去问，不让上层每秒 setState 四次 */
  getCurrentTime(): number;
  onSeek(t: number): void;
  generation?: CaptionGeneration;
  /**
   * M3.7 / D42：译文语言，服务端读出来传下来（`user_settings.captionLang`）。
   * `null` = 这个键还不存在（老用户的值可能还躺在 localStorage 里，挂载后搬一次）；
   * `""` = 他明确关掉了译文，**别再从 localStorage 把旧值搬回来**。
   */
  captionLang?: string | null;
  /**
   * M3.7 / D40：整片扫出来的词组，已经对齐到当前字幕（`段下标 → 词组`）。
   * **对齐与校验在 `resolvePhrases` 里做**，这里拿到的每一条都保证能在那一行里找到。
   */
  highlights?: Map<number, PhraseItem>;
  /** 已经收进词库的词组原文 —— 决定高亮是实心还是虚线 */
  savedTerms?: Set<string>;
  onToggleTerm?: (phrase: PhraseItem) => void;
  /** M3.10：刚收下的词，解释取到哪一步了。**答案就长在他点的那一行下面** */
  glosses?: Map<string, GlossState>;
  onRetryGloss?: (term: string) => void;
  /** M3.11：悬浮/长按一个阴影词就查词。气泡在最外层一处，这里只往上报 */
  onLookup?: (term: string, rect: DOMRect, contextQuote: string) => void;
  onLookupLeave?: () => void;
  /** M3.10 / D42：这条内容是什么语言。划词切块的 locale 用它，**不许假设英文** */
  contentLang?: string | null;
  /**
   * D45：AI 自动标词开着吗（**默认关**）。创始人 2026-08-02 指名把这颗开关
   * 放在「字幕」这一块里 —— 它管的就是字幕上那些高亮，摆在这儿才对得上。
   */
  autoScan?: boolean;
  /** 拨这颗开关。**开 = 顺便当场扫这一片**（花钱，所以只由人点，代码永不自动开） */
  onToggleAutoScan?: () => void;
  /** 正在扫。开关旁边那行小字要如实说「正在扫这一片…」，别让人以为点了没反应 */
  scanning?: boolean;
  /**
   * M3.15 片 g（D67）：观看页宽屏的布局仓库。**只有宽屏观看页传**。
   * 字幕栏头上的选择器订它；切回「专注字幕」时这里要把字幕列表滚回当前行（藏起来那会儿 `scrollTop` 被浏览器清零了）。
   * 「字幕在视频下面」那三行**一直渲染着**，显不显示由 `globals.css` 按 grid 上的 `data-layout` 决定 —— 切布局这一栏一次都不重画
   */
  layoutStore?: LayoutStore;
  /** 选了一种布局（watch-stage 负责改 grid 上的属性 + 存进 user_settings） */
  onLayout?: (next: WatchLayout) => void;
}

export function CaptionLayer({
  sourceId,
  transcript,
  kind,
  getCurrentTime,
  onSeek,
  generation,
  captionLang = null,
  highlights,
  savedTerms,
  onToggleTerm,
  glosses,
  onRetryGloss,
  onLookup,
  onLookupLeave,
  contentLang,
  autoScan = false,
  onToggleAutoScan,
  scanning = false,
  layoutStore,
  onLayout,
}: CaptionLayerProps) {
  const t = useCopy();
  // YouTube 视频自己带 CC，用户粘贴过来免费又快；只有没 CC 的才值得花钱走 Gemini。
  // 所以 YouTube 默认引导粘贴，把"自动生成"降为次选。
  const youtube = kind === "youtube";
  const router = useRouter();
  const [segments, setSegments] = useState<TranscriptSegment[]>(transcript ?? []);
  const [on, setOn] = useState(true);
  const [follow, setFollow] = useState(true);
  const [active, setActive] = useState(-1);
  /**
   * 片 g：「字幕在视频下面」那三行以哪一句为中间那行。平时就是 `active`；
   * **正在那三行里选词 / 挂着刚收下那个词的解释时停住不动**（见 250ms 那一轮）——
   * 不停的话，视频一播，他选到一半的那一行就被换掉了，划词等于用不了
   */
  const [anchor, setAnchor] = useState(-1);
  /** 片 g：宽屏上「AI 标词 / 字号 / 译文」收进了头上那颗齿轮 —— 它开着没有 */
  const [gearOpen, setGearOpen] = useState(false);
  const isWide = useIsWide();

  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // === M2.9 双语字幕 ===
  // 译文语言的初值直接来自服务端（props，SSR 与客户端一致，不会水合不一致，
  // 也不再"先闪一下关闭再跳出来"）。flip / 只当前行仍在挂载后读 localStorage。
  const [lang, setLang] = useState(captionLang ?? ""); // "" = 不显示译文
  const [flip, setFlip] = useState(false); // true = 译文大原文小
  const [trOnlyCurrent, setTrOnlyCurrent] = useState(false); // true = 只在当前行显示译文
  const [tr, setTr] = useState<Map<number, string>>(new Map()); // 字幕下标 → 译文
  const [trRunning, setTrRunning] = useState(false);
  const [trDone, setTrDone] = useState(0);
  const [trTotal, setTrTotal] = useState(0);
  const [trNote, setTrNote] = useState(""); // 翻译失败/未翻完的人话
  /**
   * 「重新加载译文」按一下 +1 —— 下面那条翻译 effect 认它，就再要一次（2026-09-13 创始人：「应该加上重新加载翻译按钮」）。
   * 这是 D44 要的「人点得动的重试」：花钱的动作只由人点，代码自己永远不重试；服务端只补缺的，已经翻好的那几行不重花钱
   */
  const [trReload, setTrReload] = useState(0);
  /**
   * 服务端亲口确认过的「原文语言」（`same-language` 那一条带回来的）。
   *
   * 为什么不只用 `contentLang` 这个 prop：那一列对 YouTube 常年是空的
   * （转写那条路从来不报语言），而服务端刚判完的结论**这一秒就能用上** ——
   * 不用等他刷新页面才看见选择器上多出「（原文）」。
   *
   * 跟 `sourceId` 绑在一起存：万一哪天组件没重挂就换了内容，旧结论当场作废，
   * 不会把上一支视频的语言标到这一支头上。
   */
  const [confirmed, setConfirmed] = useState({ sourceId, lang: "" });
  const confirmedSourceLang = confirmed.sourceId === sourceId ? confirmed.lang : "";

  const activeRef = useRef<HTMLLIElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  /** 片 g：整份字幕那个列表（能滚的那一层）和它最后停在哪儿 —— 切去三行再切回来时要还原 */
  const listBoxRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef(0);
  /** 片 g：视频下面那三行的外框（固定高、自己不出滚动条）和里面那一层（量它长没长高） */
  const threeRef = useRef<HTMLDivElement>(null);
  const threeInnerRef = useRef<HTMLDivElement>(null);
  const gearBtnRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const sizeRef = useRef(SIZE_DEFAULT);
  /** 片 g2：①② 的字号 / ③ 自己的字号（null = 没在 ③ 里调过 → 跟着 ①② 的大一档）。眼下用的是哪个在 `sizeRef` */
  const baseSizeRef = useRef(SIZE_DEFAULT);
  const wideSizeRef = useRef<number | null>(null);

  // 服务端数据变了（贴完字幕 router.refresh 之后）就跟着换。渲染期校正，不用 effect
  const [seen, setSeen] = useState(transcript);
  if (transcript !== seen) {
    setSeen(transcript);
    if (transcript) setSegments(transcript);
  }

  /**
   * 字号刻意**不进 state**：它是纯样式，走一个 CSS 变量直接写进 DOM。
   * 好处有二 —— ① 拖滑杆不会把整列字幕重渲染一遍；
   * ② 服务端渲染时用默认值、客户端读完 localStorage 再改，中间不会有
   *    "state 与 SSR 输出对不上"的水合报错。
   */
  const applySize = useCallback((next: number) => {
    sizeRef.current = next;
    rootRef.current?.style.setProperty("--caption-size", `${next}px`);
    if (labelRef.current) labelRef.current.textContent = `${next}px`;
    if (sliderRef.current && sliderRef.current.value !== String(next)) {
      sliderRef.current.value = String(next);
    }
  }, []);

  /** 滑杆可能晚于本组件才挂上（先"隐藏"再"显示"），挂上时补一次当前值 */
  const attachSlider = useCallback((el: HTMLInputElement | null) => {
    sliderRef.current = el;
    if (el) el.value = String(sizeRef.current);
  }, []);
  /**
   * 旁边那个「22px」的读数也一样：它只在 `applySize` 时被改写，**晚挂上的那一份会一直显示 JSX 里写死的 18px**。
   * 片 g 起齿轮浮层每开一次就重挂一次 —— 于是他把字号调到 24、关上再打开，滑块在 24、读数写着 18（片 g2 在 ③ 里量到的）
   */
  const attachLabel = useCallback((el: HTMLSpanElement | null) => {
    labelRef.current = el;
    if (el) el.textContent = `${sizeRef.current}px`;
  }, []);

  /**
   * 片 g2：眼下该用哪个字号 —— 宽屏上选的是 ③ 就用 ③ 自己的，其余一律 ①② 那个。
   * `isWide` 也要看：窄屏上没有布局这回事（grid 规则都在 `lg` 里），就算他在电脑上选的是 ③，手机 / 窄窗口里也不许变大
   */
  const inWide = useCallback(() => isWide && layoutStore?.get() === "wide", [isWide, layoutStore]);
  const currentSize = useCallback(
    () => (inWide() ? (wideSizeRef.current ?? Math.min(SIZE_MAX, baseSizeRef.current + WIDE_BUMP)) : baseSizeRef.current),
    [inWide],
  );

  useEffect(() => {
    try {
      const raw = Number(localStorage.getItem(SIZE_KEY));
      if (raw >= SIZE_MIN && raw <= SIZE_MAX) baseSizeRef.current = raw;
      const wide = Number(localStorage.getItem(SIZE_WIDE_KEY));
      if (wide >= SIZE_MIN && wide <= SIZE_MAX) wideSizeRef.current = wide;
    } catch {
      // 隐私模式读不到：用默认字号，不影响看字幕
    }
    applySize(currentSize());
  }, [applySize, currentSize]);

  // 片 g2：换了布局（进 / 出 ③）就换字号。订的是仓库的「变了」这一下 —— 这一栏不为切布局重画
  useEffect(() => {
    if (!layoutStore) return;
    return layoutStore.subscribe(() => applySize(currentSize()));
  }, [layoutStore, applySize, currentSize]);

  // 挂载后读回 flip / 只当前行（纯显示口味，留在本机）
  useEffect(() => {
    try {
      if (localStorage.getItem(FLIP_KEY) === "1") setFlip(true);
      if (localStorage.getItem(TRONLY_KEY) === "1") setTrOnlyCurrent(true);
    } catch {
      // 隐私模式读不到：用默认（不显示译文），不影响看原文
    }
  }, []);

  // 老用户搬家（M3.7 / D42）：译文语言以前存在 localStorage，换设备就丢。
  // **只在后台还没有这个键时搬一次**（`captionLang === null`）——
  // 他要是明确把译文关掉（存的是 `""`），就不能再把 localStorage 里的旧值捞回来。
  //
  // 写法上：state 的校正放在**渲染期**（本文件已有的老写法），effect 里只留
  // "往外面写"这一件事 —— 那才是 effect 该干的（同时也躲开 set-state-in-effect）。
  const legacyLang = useSyncExternalStore(subscribeNothing, readLegacyLang, readServerLegacyLang);
  const [migratedFrom, setMigratedFrom] = useState<string | null>(null);
  if (captionLang === null && legacyLang && migratedFrom !== legacyLang) {
    setMigratedFrom(legacyLang);
    setLang(legacyLang);
  }
  useEffect(() => {
    if (migratedFrom) void putSettings({ captionLang: migratedFrom });
  }, [migratedFrom]);

  // 选了语言就去翻译。命中缓存瞬间全出；否则流式 NDJSON，边翻边显示进度。
  // 换语言 / 组件卸载时中断上一次请求，避免旧译文覆盖新译文。
  useEffect(() => {
    if (!lang) {
      setTr(new Map());
      setTrRunning(false);
      setTrNote("");
      setTrDone(0);
      setTrTotal(0);
      return;
    }
    if (segments.length === 0) return; // 还没字幕，没得翻

    const ctrl = new AbortController();
    setTrRunning(true);
    setTrNote("");
    setTrDone(0);
    setTrTotal(segments.length);

    (async () => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId, targetLang: lang }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? t("cap.trNoResponse"));
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const raw = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!raw.trim()) continue;
            const ev = JSON.parse(raw) as {
              type: string;
              total?: number;
              done?: number;
              translations?: { i: number; text: string }[];
              note?: string | null;
              message?: string;
              sourceLang?: string;
              complete?: boolean;
            };
            if (ev.type === "start") {
              if (ev.total) setTrTotal(ev.total);
            } else if (ev.type === "partial" || ev.type === "done") {
              if (ev.translations) {
                const next = new Map<number, string>();
                for (const item of ev.translations) next.set(item.i, item.text);
                setTr(next);
                setTrDone(ev.done ?? ev.translations.length);
              }
              if (ev.type === "done") {
                if (ev.note) setTrNote(ev.note);
                // 没翻全、服务端又没说原因（预算到点那种「正常收尾」）—— 也得说出来，
                // 不然看着就像「译文就这么多」（D44；2026-09-13 截断缓存那个 bug 就是这么藏了一个多月的）
                else if (ev.complete === false) {
                  setTrNote(t("cap.trPartial", ev.translations?.length ?? 0, segments.length));
                }
              }
            } else if (ev.type === "same-language") {
              setTr(new Map()); // 原文就是这个语言，不显示译文
              // 服务端能说得更具体就用它的（中文→中文那条走 D50，理由不一样）
              setTrNote(ev.note || t("cap.trSameLang"));
              // 选择器上给这一项标「（原文）」——**下次他还没点就知道点了不会翻**
              if (ev.sourceLang) setConfirmed({ sourceId, lang: ev.sourceLang });
            } else if (ev.type === "error") {
              setTrNote(ev.message ?? t("cap.trFailed"));
            }
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setTrNote(e instanceof Error ? e.message : t("cap.trFailed"));
        }
      } finally {
        if (!ctrl.signal.aborted) setTrRunning(false);
      }
    })();

    return () => ctrl.abort();
    // 只在语言 / 内容切换时重来。segments.length 进依赖：字幕从无到有后能自动补翻。
    //
    // ⚠️ **`t` 故意不进依赖**（M3.9 片 c）：这个 effect 会起一趟**要花钱**的翻译流。
    // 把 `t` 加进来，等于"用户点了一下中/EN，整片字幕重翻一遍"——
    // D44 的规矩是花钱的动作只由人点，界面语言不是那个开关。
    // 代价：切语言的那一刻若正好挂着一句翻译失败的提示，那句话会停在旧语言里。
    // 它是一条**已经发生过的事件**的记录，不是界面标签，停在原语言反而更诚实。
    //
    // `trReload` 进依赖是故意的：人按了「重新加载译文」—— D44 说花钱的动作只由人点，这颗按钮就是那个人点
    // （服务端只补缺的那几行，已经翻好的不重花钱）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, sourceId, segments.length, trReload]);

  // 每 250ms 问一次时间，但**只有跨句时才 setState** ——
  // 一句字幕少说两三秒，于是重渲染从每秒 4 次降到每句 1 次。
  useEffect(() => {
    if (!on || segments.length === 0) return;
    const timer = window.setInterval(() => {
      const next = activeSegmentIndex(segments, getCurrentTime());
      setActive((prev) => (prev === next ? prev : next));
      // 片 g：三行那边**正在选词就先别往下走**（`data-picking` 是 SelectableLine 挂的）。
      // 收下 / 取消 / 收起解释之后，下一轮就追上当前那句
      if (!threeRef.current?.querySelector("[data-picking]")) {
        setAnchor((prev) => (prev === next ? prev : next));
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [on, segments, getCurrentTime]);

  /**
   * 片 g：从「字幕在视频下面」切回「专注字幕」—— 字幕列表藏着（`display:none`）的那段时间里，
   * 浏览器把它的 `scrollTop` 清成了 0。**跟随中**就把当前那一句摆回中间；没跟随就回到他上次停的地方。
   *
   * 订的是仓库的「变了」这一下，不是它的值：这一栏不为切布局重画一次（切换本身只是 grid 上一个属性，见 watch-layout.ts）。
   * watch-stage 先写属性再改仓库，所以这里读位置的时候列表已经显示出来了。
   */
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    if (!layoutStore) return;
    let last = layoutStore.get();
    return layoutStore.subscribe(() => {
      const now = layoutStore.get();
      const from = last;
      last = now;
      if (now !== "focus" || from === "focus") return;
      const box = listBoxRef.current;
      if (!box) return;
      const line = activeRef.current;
      if (followRef.current && line) {
        // 只改这一个框自己的 scrollTop —— `scrollIntoView` 会连带去滚外面那几层
        const b = box.getBoundingClientRect();
        const r = line.getBoundingClientRect();
        box.scrollTop += r.top - b.top - Math.max(0, (box.clientHeight - r.height) / 2);
      } else {
        box.scrollTop = listScrollRef.current;
      }
    });
  }, [layoutStore]);

  /**
   * 片 g：三行里一选词，那一行下面会长出「收下 / 取消」（或者解释）—— 外框是**固定高**的
   * （它的高度算在视频的高度上限里，一变视频就跟着缩放，所以不许变），长出来的那截要**框里自己滚过去**给他看；
   * 选完了再滚回顶上。外框不出滚动条（`overflow: hidden` 也能程序化地滚）。
   */
  useEffect(() => {
    const box = threeRef.current;
    const inner = threeInnerRef.current;
    if (!box || !inner) return;
    const ro = new ResizeObserver(() => {
      const act = box.querySelector<HTMLElement>("[data-pick-actions]");
      if (!act) {
        box.scrollTop = 0;
        return;
      }
      const b = box.getBoundingClientRect();
      const r = act.getBoundingClientRect();
      if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4;
      else if (r.top < b.top) box.scrollTop -= b.top - r.top + 4;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [on, segments.length]);

  /** 齿轮面板：点到外面 / 按 Esc 就收起（Esc 顺手把焦点还给齿轮，键盘用户不至于迷路） */
  useEffect(() => {
    if (!gearOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (!el) return;
      if (gearBtnRef.current?.contains(el)) return;
      if ((el as Element).closest?.("[data-caption-settings]")) return;
      setGearOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setGearOpen(false);
      gearBtnRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [gearOpen]);

  useEffect(() => {
    if (!follow || active < 0) return;
    // block:"nearest" —— 只在字幕框内滚，不把整个页面往上拽（视频还在上面呢）
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow]);

  /**
   * M3.10：每一行里，已经收进词库的词都在哪儿（`段下标 → 位置`）。
   *
   * 手动划的词在字幕里没有坐标（AI 标的自带 `PhraseItem.start`），只能拿词回来找。
   * **必须 memo**：整份字幕可能几百行，而这个列表跟着 250ms 的当前行一起重渲染 ——
   * 每次都全表扫一遍，手机会烫。这里只在「字幕变了」或「词库变了」时算一次。
   * 一个词都没收过就直接空表返回，绝大多数情况连循环都不进。
   */
  /**
   * 译文选择器里，哪一项就是这条内容的原文 —— 标上「（原文）」，**点了不会翻**。
   *
   * 2026-08-08 创始人的原话：日语视频选日语译文，它还是花钱翻了一遍。服务端那半已经
   * 不翻了，这半是把结论摆到他点之前 —— 省钱这件事得看得见，不能只写在事后那句提示里。
   *
   * 中文要**精确比**（简体/繁体是两项，标错一项等于骗人），而且**只认服务端刚确认的那条**：
   * 库里存的字形不一定就是屏幕上那套（读侧会按他的语言转，D50）——
   * 库里是简体、屏幕上是繁体时，把「简体中文」标成原文就是在骗他，那一项点下去真的会变。
   *
   * 其余语言只比主子标签（`en-US` 和 `en` 是一回事）。判不出来时一项都不标 ——
   * 不知道就别装知道。
   */
  const isOriginalLang = useCallback(
    (code: string) => {
      const isZh = (s: string) => s.startsWith("zh");
      if (confirmedSourceLang) {
        const src = normalizeLang(confirmedSourceLang);
        return isZh(src) || isZh(code) ? src === code : sameLang(src, code);
      }
      const stored = normalizeLang(contentLang || "");
      if (!stored || isZh(stored) || isZh(code)) return false;
      return sameLang(stored, code);
    },
    [confirmedSourceLang, contentLang],
  );

  const savedSpansByLine = useMemo(() => {
    const m = new Map<number, TermSpan[]>();
    if (!savedTerms || savedTerms.size === 0) return m;
    segments.forEach((seg, i) => {
      const found = findTerms(seg.text, savedTerms);
      if (found.length > 0) m.set(i, found);
    });
    return m;
  }, [segments, savedTerms]);

  async function submitDraft() {
    const parsed = parseTranscript(draft);
    if (parsed.length === 0) {
      setError(
        t("cap.parseFailed"),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/sources/${sourceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: parsed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? t("cap.saveFailed"));
      // D50：存进库的是他贴进来的原样（那是这条内容的底本），**显示的那份由服务端按他的
      // 字形转好一起回来** —— 词库在服务端，客户端不自己转
      setSegments(Array.isArray(body.transcript) ? body.transcript : parsed);
      setPasting(false);
      setDraft("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cap.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const hasCaptions = segments.length > 0;

  /** 生成进度百分比。时长未知就不显示数字 —— 别编一个假的出来 */
  const percent =
    generation?.totalS && generation.coveredS != null
      ? Math.min(99, Math.round((generation.coveredS / generation.totalS) * 100))
      : null;

  // === M2.9 派生值 + 持久化处理器 ===
  const trPercent = trTotal > 0 ? Math.min(99, Math.round((trDone / trTotal) * 100)) : null;
  const showTranslation = !!lang && tr.size > 0;

  // D42：译文语言存后台 —— 换台设备也记得（M2.9 存 localStorage 是要还的账）
  const pickLang = (v: string) => {
    setLang(v);
    void putSettings({ captionLang: v });
  };
  const toggleFlip = () =>
    setFlip((v) => {
      const next = !v;
      try {
        localStorage.setItem(FLIP_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  const toggleOnlyCurrent = () =>
    setTrOnlyCurrent((v) => {
      const next = !v;
      try {
        localStorage.setItem(TRONLY_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  /**
   * **死路**：转写失败了，而且重试一万次也回同一句（视频不公开 / 地区限制…）。
   *
   * 这个状态从前长得跟"抽风了，再点一下"一模一样 —— 一个大绿「重试」，
   * 而真正管用的「粘贴字幕」是暗色的、缩在右边。创始人 2026-08-31 就撞在这上面：
   * 一支伯克利的 unlisted 课程视频，人能看、YouTube 的 CC 也在放，
   * 界面却只会请他再点一次那个永远不会成功的按钮。**主次在这儿必须对调。**
   */
  const deadEnd = Boolean(generation?.error) && generation?.permanent === true;

  const PRIMARY_BTN = "min-h-11 flex-1 rounded-xl bg-teal-400 px-4 text-sm font-semibold text-teal-950";
  const SECONDARY_BTN = "min-h-11 rounded-xl border border-ink-700 px-4 text-sm text-ink-300";

  // 两颗按钮先做出来，**摆放顺序由 deadEnd 决定** —— 用 DOM 顺序换位置而不是 CSS
  // `order`，这样看到的顺序和 Tab 走的顺序永远是同一个。
  const retryBtn = generation ? (
    <button
      key="retry"
      type="button"
      onClick={generation.onRun}
      className={deadEnd ? SECONDARY_BTN : PRIMARY_BTN}
    >
      {generation.error
        ? deadEnd
          ? t("cap.retryAnyway")
          : t("cap.retry")
        : generation.resumable
          ? t("cap.resume")
          : t("cap.generate")}
    </button>
  ) : null;

  const pasteBtn = (
    <button
      key="paste"
      type="button"
      onClick={() => setPasting(true)}
      className={deadEnd ? PRIMARY_BTN : SECONDARY_BTN}
    >
      {youtube ? t("cap.pasteYt") : t("cap.pasteManual")}
    </button>
  );

  /**
   * 片 g：字幕的三行设置（AI 标词 / 字号 / 译文）。**同一份 JSX，只会挂在一个地方**：
   * 窄屏摆在字幕栏里原来的位置（一个像素不动）；宽屏收进齿轮浮层（`CaptionSettingsPop`）。
   * 字号滑杆靠 `attachSlider` 这个 ref 回调接上，挂在哪儿都一样（它本来就是为「滑杆晚挂上」写的）。
   */
  const settingsRows = (
    <>
      {/* D45 —— AI 自动标词的开关（创始人 2026-08-02 指名放在「字幕」这儿，
          并且要做成拨动开关的样子）。**默认关**：手动选词才是主路径，
          一个降级成"顺带提示"的功能不该在背后自己花钱。
          开 = 当场就把这一片扫了。关 = 只是不再自动跑，**已经标出来的不删**。 */}
      {onToggleAutoScan && (
        <div className="mt-2 flex items-center gap-2.5 px-1">
          <Toggle
            id="autoscan-toggle"
            on={autoScan}
            onChange={onToggleAutoScan}
            label={autoScan ? t("cap.scanOff") : t("cap.scanOn")}
          />
          <label htmlFor="autoscan-toggle" className="min-w-0 text-[0.68rem] leading-4">
            <span className="text-ink-300">{t("cap.scanLabel")}</span>
            <span className="ml-1.5 text-ink-500">
              {scanning
                ? t("cap.scanRunning")
                : autoScan
                  ? t("cap.scanIsOn")
                  : t("cap.scanIsOff")}
            </span>
          </label>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 px-1">
        <span className="text-[0.68rem] text-ink-500">{t("cap.size")}</span>
        <input
          ref={attachSlider}
          type="range"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={1}
          defaultValue={SIZE_DEFAULT}
          aria-label={t("cap.sizeAria")}
          onChange={(e) => {
            const next = Number(e.target.value);
            // 片 g2：在 ③ 里调的只算 ③ 的（见 SIZE_WIDE_KEY）
            const wide = inWide();
            if (wide) wideSizeRef.current = next;
            else baseSizeRef.current = next;
            applySize(next);
            try {
              localStorage.setItem(wide ? SIZE_WIDE_KEY : SIZE_KEY, String(next));
            } catch {
              // 存不进不致命，下次回默认字号
            }
          }}
          className="h-6 flex-1 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-ink-700 [&::-webkit-slider-thumb]:mt-[-0.4rem] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-teal-400 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-teal-400 [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-ink-700"
        />
        <span ref={attachLabel} className="ui-mono text-[0.68rem] text-ink-500">
          {SIZE_DEFAULT}px
        </span>
      </div>

      {/* M2.9 双语字幕：选语言（默认关闭）+ flip 对调大小 + 只当前行 + 进度 */}
      <div className="mt-2 flex flex-wrap items-center gap-2 px-1 text-[0.68rem]">
        <span className="text-ink-500">{t("cap.translation")}</span>
        <select
          value={lang}
          onChange={(e) => pickLang(e.target.value)}
          aria-label={t("cap.translationAria")}
          // `lg:max-w-40`（2026-09-13）：宽屏上这一行原来刚好一行放下，加了 ↻ 就折成两行、字幕少 40px。
          // 选择器按最长的那个选项撑到 245px，而选中后显示的只是「简体中文」这种短名 —— 收到 160px 这一行就又放得下了。
          // 手机不设：那边这一行本来就折成两行，↻ 落在第二行里，一个像素不动（375×812 逐数量过）
          className="h-8 rounded-lg border border-ink-700 bg-ink-900 px-2 text-ink-100 outline-none focus:border-teal-400 lg:max-w-40"
        >
          <option value="">{t("cap.translationOff")}</option>
          {TARGET_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
              {isOriginalLang(l.code) ? t("cap.sameLangSuffix") : ""}
            </option>
          ))}
        </select>
        {lang && (
          <>
            <button
              type="button"
              onClick={toggleFlip}
              aria-label={t("cap.flipAria")}
              className="h-8 rounded-lg px-2 text-ink-300 hover:text-teal-300"
            >
              {flip ? t("cap.flipToTr") : t("cap.flipToOrig")}
            </button>
            <button
              type="button"
              onClick={toggleOnlyCurrent}
              aria-pressed={trOnlyCurrent}
              className={`h-8 rounded-lg px-2 transition-colors ${
                trOnlyCurrent ? "text-teal-300" : "text-ink-500 hover:text-ink-300"
              }`}
            >
              {trOnlyCurrent ? t("cap.trOnlyCurrent") : t("cap.trEveryLine")}
            </button>
            {trRunning ? (
              // 宽屏上这一行在齿轮里 —— 进度改由字幕栏头上那一句说（面板收着也看得见），这里不重复
              <span className="ui-mono text-teal-300/80 lg:hidden">
                {t("cap.translating", trPercent != null ? ` ${trPercent}%` : "…")}
              </span>
            ) : (
              // 2026-09-13 创始人：「怎么翻译没了？……应该加上重新加载翻译按钮」。
              // 那一回的根因在服务端（缓存里只存了前两分钟，见 /api/translate「缓存优先」那段），已修；
              // 这颗是给**任何**一种没翻全 / 没翻成的情况留的人工重来（D44：花钱只由人点，代码自己不重试）。
              // 翻译进行中不出现 —— 那时这个位置是进度，手机上这一行也就不会因为它多折一行
              <button
                type="button"
                onClick={() => setTrReload((n) => n + 1)}
                // 宽屏只露 ↻（字收进 sr-only：读屏照念，悬停有 title）—— 那一行再多几个字就折成两行、字幕少 40px（1512 宽量的）。
                // 手机上字照常显示：那边这一行本来就是两行，它落在第二行里
                title={t("cap.trReload")}
                className="flex h-8 items-center gap-1 rounded-lg px-2 text-ink-500 transition-colors hover:text-teal-300"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden focusable="false">
                  <path
                    d="M10 6a4 4 0 1 1-1.2-2.85M10 1.6v2.6H7.4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="lg:sr-only">{t("cap.trReload")}</span>
              </button>
            )}
          </>
        )}
        {/* 原来写的是调色板外的 ink「400」档 —— Tailwind 静默丢掉、字退回继承色（M3.15 日志 🐞 那一条）。
            注释里别写那个类名的原样：日志里那条 grep 守门会把注释也当成一处错色 */}
        {/* 宽屏上这句挪到了字幕栏头底下（面板收着也看得见，D44），这里 `lg:hidden` 免得面板打开时说两遍 */}
        {trNote && !trRunning && <span className="text-ink-300 lg:hidden">{trNote}</span>}
      </div>
    </>
  );

  /**
   * 片 g：「字幕在视频下面」那三行里的一行（`role`：cur = 正在说的那句，亮；dim = 上一句 / 下一句，灰）。
   *
   * 和下面整份列表里那一行**长得像、但不是同一段代码**：列表那一行一个字不动（「专注字幕」必须和今天逐像素一样），
   * 这里另写一份，只多三样东西 ——
   * ① **行数夹住**：YouTube 那一档外框是固定高（它的高度算在视频的高度上限里，一变视频就跟着缩放），
   *    所以正在说的那句最多两行、另外两句各一行（生产库 10140 句 YouTube 字幕：中位 40 字、九成 ≤118 字 —— 两行装得下九成以上）。
   *    **只夹字，不夹整块**（`textClassName`）：夹整块会把「收下 / 取消」那排按钮一起剪掉。
   *    播客那一档不固定高（左边没有视频要让），正在说的那句整句都给。
   * ② 行高 1.5 而不是列表的 1.85：1.85 是给手指点词留的（M3.10），这三行只在宽屏出现，鼠标点得准。
   * ③ 字号走外框上的 `--wl-big` / `--wl-small`，固定高那个算式（globals.css）吃的是同一对数。
   */
  const threeRow = (i: number, role: "cur" | "dim") => {
    const cur = role === "cur";
    const seg = segments[i];
    if (!seg) {
      // 片头之前 / 片尾之后：占着位置的空行，外框高度不跟着变
      return <div key={`pad-${role}-${i}`} className={cur ? "wl-row-cur" : "wl-row-dim"} aria-hidden />;
    }
    const translation = showTranslation ? tr.get(i) : undefined;
    const rowShowsTr = !!translation && (!trOnlyCurrent || cur);
    const phrase = highlights?.get(i);
    const saved = !!phrase && !!savedTerms?.has(phrase.text);
    const bigClamp = cur ? (youtube ? "line-clamp-2" : "") : youtube ? "line-clamp-1" : "line-clamp-2";
    const smallClamp = cur && !youtube ? "" : "line-clamp-1";
    const big = { fontSize: "var(--wl-big)", lineHeight: 1.5 };
    const small = { fontSize: "var(--wl-small)", lineHeight: 1.4 };
    const swapped = flip && rowShowsTr;
    const original = (
      <SelectableLine
        text={seg.text}
        i={i}
        t={seg.start}
        contentLang={contentLang}
        phrase={phrase}
        savedSpans={savedSpansByLine.get(i)}
        onToggleTerm={onToggleTerm}
        glosses={glosses}
        onRetryGloss={onRetryGloss}
        onLookup={onLookup}
        onLookupLeave={onLookupLeave}
        textClassName={swapped ? smallClamp : bigClamp}
        className={swapped ? "opacity-65" : undefined}
        style={swapped ? small : big}
      />
    );
    const translated = rowShowsTr ? (
      <span className={`block ${swapped ? bigClamp : `opacity-65 ${smallClamp}`}`} style={swapped ? big : small}>
        {translation}
      </span>
    ) : null;
    return (
      // `flex-col justify-center`：行高是按「最多两行」留的，只有一行字时别让字贴着顶、底下空一大截
      <div key={`${seg.start}-${i}`} className={`relative flex flex-col justify-center ${cur ? "wl-row-cur" : "wl-row-dim"}`}>
        {/* 整行点一下 = 跳到这一句（和列表同一个手感）。上一句点一下就是「刚才那句再听一遍」 */}
        <button
          type="button"
          onClick={() => onSeek(seg.start)}
          aria-label={t("cap.jumpAria", mmss(seg.start))}
          className={`absolute inset-0 rounded-xl transition-colors ${cur ? "bg-ink-700/60" : "hover:bg-ink-700/30"}`}
        />
        <div
          className={`pointer-events-none relative flex gap-3 rounded-xl px-2 py-1 text-left ${
            cur ? "text-ink-100" : "text-ink-500"
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSeek(seg.start);
            }}
            aria-label={t("cap.jumpAria", mmss(seg.start))}
            className="ui-mono pointer-events-auto relative z-10 -mt-0.5 shrink-0 self-start rounded-lg px-1 py-1 text-[0.68rem] text-ink-500 transition-colors hover:bg-ink-900 hover:text-teal-300"
          >
            {mmss(seg.start)}
          </button>
          {/* `wl-three-text`：③「沉浸 · 宽」里居中（globals.css） */}
          <div className="wl-three-text min-w-0 flex-1">
            {swapped ? translated : original}
            {swapped ? original : translated}
          </div>
          {/* 负边距：✓ 那颗 28px 高，比一行字高 —— 别让它把灰的那两行撑高、把固定高的外框撑出滚动 */}
          <div className="-my-1 shrink-0 self-start">
            <PhraseCheck phrase={phrase} saved={saved} onToggle={onToggleTerm} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <section
      ref={rootRef}
      aria-labelledby="captions-title"
      // M3.12：宽屏下这一整块要**吃满右栏给的高度**（右栏自己有多高，由 watch-stage
      // 按视频下沿量出来 —— 见那边的 measureCaptions）。窄屏一个像素不动（全是 `lg:`）：
      // 手机上字幕本来就是视频下面的一个 256px 小窗，那样是对的。
      className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
      style={{ "--caption-size": `${SIZE_DEFAULT}px` } as CSSProperties}
    >
      <div className="flex items-center justify-between px-1">
        <p id="captions-title" className="eyebrow">
          {t("cap.title")}
        </p>
        {hasCaptions && (
          <div className="flex items-center gap-1">
            {/* 字幕已经在长了，但还没长完 —— 让用户知道后面还有，别以为就这么点 */}
            {generation?.running && (
              <span className="ui-mono mr-1 text-[0.62rem] text-teal-300/80">
                {t("cap.generating", percent != null ? ` ${percent}%` : "…")}
              </span>
            )}
            {/* 片 g：宽屏上「AI 标词」「译文」收进了齿轮 —— **正在扫 / 正在翻的进度得露在外面**，
                不然点完开关、面板一收，就像什么都没发生（D44）。窄屏那两行还摆在原地，这两句不出现 */}
            {on && scanning && (
              <span className="mr-1 hidden text-[0.62rem] text-teal-300/80 lg:inline">{t("cap.scanRunning")}</span>
            )}
            {on && trRunning && (
              <span className="ui-mono mr-1 hidden text-[0.62rem] text-teal-300/80 lg:inline">
                {t("cap.translating", trPercent != null ? ` ${trPercent}%` : "…")}
              </span>
            )}
            {/* 片 g（D67）：布局选择器 —— 只在宽屏观看页出现（组件自己 `hidden lg:flex`） */}
            {layoutStore && onLayout && <LayoutPicker store={layoutStore} onPick={onLayout} />}
            {/* `wl-list-only`：三行那种排法里没有「跟随」这回事（永远是当前那句在中间），那时藏起来（globals.css） */}
            <button
              type="button"
              onClick={() => setFollow((v) => !v)}
              aria-pressed={follow}
              className={`wl-list-only h-8 rounded-lg px-2 text-[0.68rem] transition-colors ${
                follow ? "text-teal-300" : "text-ink-500 hover:text-ink-300"
              }`}
            >
              {follow ? t("cap.follow") : t("cap.noFollow")}
            </button>
            <button
              type="button"
              onClick={() => setOn((v) => !v)}
              aria-pressed={on}
              className="h-8 rounded-lg px-2 text-[0.68rem] text-ink-300 hover:text-teal-300"
            >
              {on ? t("cap.hide") : t("cap.show")}
            </button>
            {/* 片 g：计划 §D 那笔债 —— 「AI 标词 / 字号 / 译文」是设好就不再动的东西，**宽屏上收进这颗齿轮**，
                省出来的高度全给字幕。窄屏没有这颗（那边的几行原样摆着，改窄屏要单独立项） */}
            {on && (
              <button
                ref={gearBtnRef}
                type="button"
                onClick={() => setGearOpen((v) => !v)}
                aria-expanded={gearOpen}
                aria-haspopup="dialog"
                aria-label={t("cap.settings")}
                title={t("cap.settings")}
                className={`hidden h-8 w-8 items-center justify-center rounded-lg transition-colors lg:flex ${
                  gearOpen ? "bg-ink-700 text-teal-300" : "text-ink-500 hover:text-teal-300"
                }`}
              >
                {/* 和页头那颗「设置」同一个画法（settings-link.tsx）：齿压进环里，读起来才是齿轮不是太阳 */}
                <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" aria-hidden focusable="false">
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                    <rect
                      key={deg}
                      x="10.85"
                      y="1.9"
                      width="2.3"
                      height="5.2"
                      rx="0.8"
                      fill="currentColor"
                      transform={`rotate(${deg} 12 12)`}
                    />
                  ))}
                  <circle cx="12" cy="12" r="5.1" fill="none" stroke="currentColor" strokeWidth="2.2" />
                  <circle cx="12" cy="12" r="2.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
      {/* 片 g：译文没翻全 / 没翻成那句话 —— 宽屏上它原来那一行收进了齿轮，**失败必须露在外面**（D44），所以在这儿再说一遍。
          窄屏不出现（那边它还在原来那一行里） */}
      {hasCaptions && on && trNote && !trRunning && (
        <p className="mt-1 hidden px-1 text-[0.68rem] leading-4 text-ink-300 lg:block">{trNote}</p>
      )}

      {!hasCaptions ? (
        pasting ? (
          <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-ink-700 p-3">
            {youtube ? (
              <div className="text-xs leading-5 text-ink-500">
                <p className="mb-1 text-ink-300">{t("cap.pasteYtLead")}</p>
                <YoutubeCopySteps />
                <p className="mt-1">{t("cap.pasteYtTail")}</p>
              </div>
            ) : (
              <label htmlFor="caption-draft" className="text-xs leading-5 text-ink-500">
                {t("cap.pasteManualLeadA")}{" "}
                <span className="ui-mono">00:00:12,340 --&gt; 00:00:15,000</span>
                {t("cap.pasteManualLeadB")}
              </label>
            )}
            <textarea
              id="caption-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-ink-500/70 bg-ink-900 p-3 text-xs leading-5 text-ink-100 outline-none focus:border-teal-400"
              placeholder={youtube ? t("cap.pastePlaceholderYt") : t("cap.pastePlaceholderSrt")}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || draft.trim().length === 0}
                onClick={submitDraft}
                className="min-h-11 flex-1 rounded-xl bg-teal-400 text-sm font-semibold text-teal-950 disabled:opacity-50"
              >
                {busy ? t("cap.saving") : t("cap.save")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPasting(false);
                  setError("");
                }}
                className="min-h-11 rounded-xl border border-ink-700 px-4 text-sm text-ink-300"
              >
                {t("cap.cancel")}
              </button>
            </div>
            {error && (
              <p role="alert" className="text-xs leading-5 text-red-400">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-dashed border-ink-700 px-4 py-3">
            {generation?.running ? (
              <p className="flex items-center gap-2 text-xs leading-5 text-teal-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" aria-hidden />
                {t("cap.generatingLong", percent != null ? `（${percent}%）` : "…")}
              </p>
            ) : generation?.error ? (
              <>
                <p role="alert" className="text-xs leading-5 text-red-400">
                  {generation.error}
                </p>
                {/* 死路上光报错等于把人扔在原地。**能打开这支视频，就说明字幕
                    本来就在那儿** —— 把搬运方法当场摊开，不用先点开粘贴框才看得见。 */}
                {deadEnd && youtube && (
                  <div className="text-xs leading-5 text-ink-500">
                    <p className="mb-1 text-ink-300">
                      {t("cap.deadEndLead")}
                    </p>
                    <YoutubeCopySteps />
                  </div>
                )}
              </>
            ) : youtube ? (
              <p className="text-xs leading-5 text-ink-500">
                {t("cap.hintGenerateA")}
                <span className="text-ink-300">{t("cap.hintGenerateBtn")}</span>
                {t("cap.hintGenerateB")}
              </p>
            ) : (
              <p className="text-xs leading-5 text-ink-500">{t("cap.none")}</p>
            )}

            {!generation?.running && (
              // 手机上「显示转录」没入口，粘贴基本只对电脑用户成立（D30/D28）。
              // 所以平时「生成字幕」（一键，命中缓存则免费）是主按钮，粘贴降为次选。
              // **走进死路时整个对调**（deadEnd）：那时候「重试」是假出路，不配当主按钮。
              <div className="flex flex-wrap gap-2">
                {deadEnd ? [pasteBtn, retryBtn] : [retryBtn, pasteBtn]}
              </div>
            )}
          </div>
        )
      ) : !on ? null : (
        <>
          {/* 片 g：「AI 标词 / 字号 / 译文」那三行 —— **窄屏原样摆在这儿**（改窄屏要单独立项，一个像素不许动）；
              宽屏收进字幕栏头上的齿轮（下面那个浮层），这一份不挂载。
              `lg:hidden` 是给水合前那一帧的：服务端不知道窗口多宽，先当窄屏渲染 —— 宽屏上它得一开始就是藏着的，不然会闪一下 */}
          {!isWide && <div className="lg:hidden">{settingsRows}</div>}

          {/* M3.10 / D45：字幕列表是划词的**第二个入口** —— D39 把暂停面板收成细条，
              为的就是往回翻着划。手势不说出口就等于没做（创始人上一轮真机反馈的原话是
              「我好像没看到重新扫描在哪里」），所以这行小字必须在 */}
          {/* `wl-list-only`（片 g）：只在「整份字幕列表」那种排法里出现；三行那种排法寸土寸金，藏起来（globals.css） */}
          {onToggleTerm && (
            <p className="wl-list-only mt-2 text-[0.68rem] leading-4 text-ink-500">
              {t("cap.pickHint")}
            </p>
          )}
          {/* `lg:` 那三个类：宽屏下这个框自己长满剩下的高度（`min-h-0` 不写它就不肯
              缩到内容以下，`overflow-y-auto` 会失效）。窄屏仍是 `max-h-64` 的小窗。
              片 g：一路记着滚到哪儿（切去三行再切回来要还原 —— 藏着的时候浏览器会把它清零） */}
          <div
            ref={listBoxRef}
            onScroll={(e) => {
              listScrollRef.current = e.currentTarget.scrollTop;
            }}
            className="wl-list-only mt-2 max-h-64 overflow-y-auto rounded-2xl border border-ink-700 p-2 lg:max-h-none lg:min-h-0 lg:flex-1"
          >
            <ul className="caption-copy flex flex-col">
              {segments.map((seg, i) => {
                const isActive = i === active;
                // 这一行显不显示译文：开了语言 + 这句有译文 +（每行显示 或 正好是当前行）
                const translation = showTranslation ? tr.get(i) : undefined;
                const lineShowsTr = !!translation && (!trOnlyCurrent || isActive);
                // M3.7：这一行标出来的词组（至多一个，D40）+ 它收没收进词库
                const phrase = highlights?.get(i);
                const saved = !!phrase && !!savedTerms?.has(phrase.text);
                // 原文那一段的样式（有译文时缩约 13% 给译文让位）
                // M3.10：能划词的时候把行高从 1.5 撑到 1.85 —— 一行才 22px 高的时候
                // 手指点词很容易点到上下那一行去。撑到 ~28px 是折中：再高列表就长得
                // 翻不动了（往回翻找一句话是这个列表的另一半用途）
                const lh = onToggleTerm ? 1.85 : 1.5;
                const originalStyle = lineShowsTr
                  ? { fontSize: "calc(var(--caption-size) * 0.87)", lineHeight: lh }
                  : { fontSize: "var(--caption-size)", lineHeight: lh };
                const original = (
                  <SelectableLine
                    text={seg.text}
                    i={i}
                    t={seg.start}
                    contentLang={contentLang}
                    phrase={phrase}
                    savedSpans={savedSpansByLine.get(i)}
                    onToggleTerm={onToggleTerm}
                    glosses={glosses}
                    onRetryGloss={onRetryGloss}
                    onLookup={onLookup}
                    onLookupLeave={onLookupLeave}
                    className={flip && lineShowsTr ? "opacity-65" : undefined}
                    style={
                      flip && lineShowsTr
                        ? { fontSize: "calc(var(--caption-size) * 0.61)", lineHeight: lh }
                        : originalStyle
                    }
                  />
                );
                const translated = (
                  <span
                    className={flip ? undefined : "opacity-65"}
                    style={{
                      fontSize: flip
                        ? "calc(var(--caption-size) * 0.87)"
                        : "calc(var(--caption-size) * 0.61)",
                      // 原来这一位挂在外层容器上，现在原文那一行要自己撑高行高（划词用），
                      // 所以译文得自己带一份，否则它会跟着一起被撑开
                      lineHeight: 1.4,
                    }}
                  >
                    {translation}
                  </span>
                );
                return (
                  <li key={`${seg.start}-${i}`} ref={isActive ? activeRef : null} className="relative">
                    {/* 整行点一下 = 跳到这一句（和点点条同一个手感）。
                        做成**绝对定位的覆盖按钮**，而不是把整行包成 <button> ——
                        M3.7 之后行内多了「词组」和「✓」两个真按钮，按钮不能套按钮。
                        正文那层 pointer-events-none，点普通文字就穿过去落到这个覆盖层上。 */}
                    <button
                      type="button"
                      onClick={() => onSeek(seg.start)}
                      aria-label={t("cap.jumpAria", mmss(seg.start))}
                      className={`absolute inset-0 rounded-xl transition-colors ${
                        isActive ? "bg-ink-700/60" : "hover:bg-ink-700/30"
                      }`}
                    />
                    <div
                      className={`pointer-events-none relative flex gap-3 rounded-xl px-2 py-1.5 text-left ${
                        isActive ? "text-ink-100" : "text-ink-500"
                      }`}
                    >
                      {/* M3.10：字里的词现在自己接住点击了，整行那层覆盖按钮只剩空白处能点到。
                          于是「跳到这一句」必须有一个**一定点得中**的地方 —— 就是这个时间戳。
                          它原来只是一段死文字，现在是真按钮（`pointer-events-auto` 才收得到点击，
                          正文那一层是 `pointer-events-none`）。 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(seg.start);
                        }}
                        aria-label={t("cap.jumpAria", mmss(seg.start))}
                        className="ui-mono pointer-events-auto relative z-10 -mt-0.5 shrink-0 rounded-lg px-1 py-1 text-[0.68rem] text-ink-500 transition-colors hover:bg-ink-900 hover:text-teal-300"
                      >
                        {mmss(seg.start)}
                      </button>
                      {lineShowsTr ? (
                        // 原文大译文小；flip 后对调谁大、谁在上。高亮永远跟着**原文**走
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          {flip ? translated : original}
                          {flip ? original : translated}
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">{original}</div>
                      )}
                      <PhraseCheck phrase={phrase} saved={saved} onToggle={onToggleTerm} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ── 片 g：「沉浸 · 窄」—— 视频下面的三行（上一句 / 正在说 / 下一句）──
              **一直渲染着**，显不显示由 grid 上的 `data-layout` 决定（globals.css 的 `.wl-three`）：
              切布局这一栏一次都不重画、列表和三行吃的是同一份字幕 + 同一份译文（`tr`），换了排法不会重新去翻（不花钱）。
              `wl-three-fixed`：YouTube 那一档外框固定高（算式在 globals.css），播客那一档不固定 */}
          <div
            ref={threeRef}
            className={`wl-three mt-2 rounded-2xl border border-ink-700 p-1 ${youtube ? "wl-three-fixed" : ""}`}
            style={
              {
                "--wl-big": showTranslation ? "calc(var(--caption-size) * 0.87)" : "var(--caption-size)",
                "--wl-small": "calc(var(--caption-size) * 0.61)",
                "--wl-tr": showTranslation ? 1 : 0,
              } as CSSProperties
            }
          >
            <div ref={threeInnerRef}>
              {threeRow(anchor - 1, "dim")}
              {threeRow(anchor, "cur")}
              {threeRow(anchor + 1, "dim")}
            </div>
          </div>
        </>
      )}

      {/* 转到一半停了（预算用完 / 中途出错）—— 字幕已经有一截，但别让用户
          以为"就这么多了"。给一句话说清楚 + 一个接着来的按钮。
          **刻意放在开关之外**：创始人真机撞到过 —— 把字幕收起来之后，
          这个按钮跟着一起没了，于是"生成了一半"就成了一个走不出去的死角。 */}
      {hasCaptions && generation && !generation.running && (generation.resumable || generation.error) && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-ink-700 px-3 py-2">
          <p className="flex-1 text-[0.68rem] leading-4 text-ink-500">
            {generation.error || t("cap.tailNote")}
          </p>
          <button
            type="button"
            onClick={generation.onRun}
            className="min-h-9 shrink-0 rounded-lg border border-teal-400/50 px-3 text-xs text-teal-300"
          >
            {generation.error ? t("cap.retry") : t("cap.resume")}
          </button>
        </div>
      )}

      {/* 片 g：齿轮浮层。**裹在调用处**（D49：`<main class="page-enter">` 上的 transform 会让 fixed 改从 main 算起） */}
      {isWide && gearOpen && hasCaptions && on && (
        <ViewportLayer>
          <CaptionSettingsPop anchorRef={gearBtnRef} label={t("cap.settings")} onClose={() => setGearOpen(false)}>
            {settingsRows}
          </CaptionSettingsPop>
        </ViewportLayer>
      )}
    </section>
  );
}

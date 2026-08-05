"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { activeSegmentIndex, parseTranscript } from "@/lib/captions";
import { PhraseCheck } from "@/components/phrase-line";
import { SelectableLine, type GlossState } from "@/components/selectable-line";
import { Toggle } from "@/components/toggle";
import type { PhraseItem } from "@/lib/phrases/types";
import { findTerms, type TermSpan } from "@/lib/segment";
import { putSettings } from "@/lib/settings-client";
import { mmss } from "@/lib/time";
import type { TranscriptSegment } from "@/lib/types";
import { TARGET_LANGS } from "@/lib/translate/langs";

// M1d — 字幕层（D4）：开关 + 字号 14–28px（存 localStorage）+ 行宽自适应（.caption-copy）
// + 跟着播放走的高亮。点某一句 = 跳到那一句，跟点点条同一个手感。
//
// M1 阶段字幕靠手贴（.srt / .vtt），目的是**先把渲染与同步验对**；
// M2 的自动转写写同一个字段、同一个形状，这个组件届时一个字都不用改。

/**
 * D42：新加的文案集中放这儿，M3.9 抽语言表时只动这一处。
 * （这个文件里还有大量早于 D42 的散装中文，那是 M3.9 片 c「只搬家」要处理的，不在本片。）
 */
const COPY = {
  pickHint: "点字幕里的词就能收进词库 · 点行首的时间戳跳到那一句",
};

const SIZE_KEY = "fermata.captions.size";
const SIZE_MIN = 14;
const SIZE_MAX = 28;
const SIZE_DEFAULT = 18;

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
}: CaptionLayerProps) {
  // YouTube 视频自己带 CC，用户粘贴过来免费又快；只有没 CC 的才值得花钱走 Gemini。
  // 所以 YouTube 默认引导粘贴，把"自动生成"降为次选。
  const youtube = kind === "youtube";
  const router = useRouter();
  const [segments, setSegments] = useState<TranscriptSegment[]>(transcript ?? []);
  const [on, setOn] = useState(true);
  const [follow, setFollow] = useState(true);
  const [active, setActive] = useState(-1);

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

  const activeRef = useRef<HTMLLIElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const sizeRef = useRef(SIZE_DEFAULT);

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

  useEffect(() => {
    let stored = SIZE_DEFAULT;
    try {
      const raw = Number(localStorage.getItem(SIZE_KEY));
      if (raw >= SIZE_MIN && raw <= SIZE_MAX) stored = raw;
    } catch {
      // 隐私模式读不到：用默认字号，不影响看字幕
    }
    applySize(stored);
  }, [applySize]);

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
          throw new Error(body.error ?? "翻译服务没响应");
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
            };
            if (ev.type === "start") {
              if (ev.total) setTrTotal(ev.total);
            } else if (ev.type === "partial" || ev.type === "done") {
              if (ev.translations) {
                const next = new Map<number, string>();
                for (const t of ev.translations) next.set(t.i, t.text);
                setTr(next);
                setTrDone(ev.done ?? ev.translations.length);
              }
              if (ev.type === "done" && ev.note) setTrNote(ev.note);
            } else if (ev.type === "same-language") {
              setTr(new Map()); // 原文就是这个语言，不显示译文
              setTrNote("这条内容的原文就是这个语言。");
            } else if (ev.type === "error") {
              setTrNote(ev.message ?? "翻译没成，稍后再试。");
            }
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setTrNote(e instanceof Error ? e.message : "翻译没成，稍后再试。");
        }
      } finally {
        if (!ctrl.signal.aborted) setTrRunning(false);
      }
    })();

    return () => ctrl.abort();
    // 只在语言 / 内容切换时重来。segments.length 进依赖：字幕从无到有后能自动补翻。
  }, [lang, sourceId, segments.length]);

  // 每 250ms 问一次时间，但**只有跨句时才 setState** ——
  // 一句字幕少说两三秒，于是重渲染从每秒 4 次降到每句 1 次。
  useEffect(() => {
    if (!on || segments.length === 0) return;
    const timer = window.setInterval(() => {
      const next = activeSegmentIndex(segments, getCurrentTime());
      setActive((prev) => (prev === next ? prev : next));
    }, 250);
    return () => window.clearInterval(timer);
  }, [on, segments, getCurrentTime]);

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
        "没认出任何一条字幕。可以是 YouTube「显示转录」复制的内容（时间戳+文字），也可以是 .srt / .vtt 文件内容。",
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "没存上，请重试");
      }
      setSegments(parsed);
      setPasting(false);
      setDraft("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "没存上，请重试");
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

  return (
    <section
      ref={rootRef}
      aria-labelledby="captions-title"
      style={{ "--caption-size": `${SIZE_DEFAULT}px` } as CSSProperties}
    >
      <div className="flex items-center justify-between px-1">
        <p id="captions-title" className="eyebrow">
          captions / 字幕
        </p>
        {hasCaptions && (
          <div className="flex items-center gap-1">
            {/* 字幕已经在长了，但还没长完 —— 让用户知道后面还有，别以为就这么点 */}
            {generation?.running && (
              <span className="ui-mono mr-1 text-[0.62rem] text-teal-300/80">
                生成中{percent != null ? ` ${percent}%` : "…"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setFollow((v) => !v)}
              aria-pressed={follow}
              className={`h-8 rounded-lg px-2 text-[0.68rem] transition-colors ${
                follow ? "text-teal-300" : "text-ink-500 hover:text-ink-300"
              }`}
            >
              {follow ? "跟随中" : "不跟随"}
            </button>
            <button
              type="button"
              onClick={() => setOn((v) => !v)}
              aria-pressed={on}
              className="h-8 rounded-lg px-2 text-[0.68rem] text-ink-300 hover:text-teal-300"
            >
              {on ? "隐藏" : "显示"}
            </button>
          </div>
        )}
      </div>

      {!hasCaptions ? (
        pasting ? (
          <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-ink-700 p-3">
            {youtube ? (
              <div className="text-xs leading-5 text-ink-500">
                <p className="mb-1 text-ink-300">有字幕(CC)的话，粘过来免费（手机上没有「显示转录」入口，这条要在电脑上做）：</p>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>电脑浏览器打开这个视频 → 视频下方「<span className="text-ink-300">...更多</span>」→「<span className="text-ink-300">显示转录 / Show transcript</span>」</li>
                  <li>在弹出的转录里 <span className="text-ink-300">全选、复制</span></li>
                  <li>回到这里，整段 <span className="text-ink-300">粘</span> 进下面的框</li>
                </ol>
                <p className="mt-1">认 YouTube 那种「时间戳+文字」，也认 .srt / .vtt。手机上直接用「生成字幕」就行。</p>
              </div>
            ) : (
              <label htmlFor="caption-draft" className="text-xs leading-5 text-ink-500">
                把 .srt 或 .vtt 的内容整段贴进来（要带{" "}
                <span className="ui-mono">00:00:12,340 --&gt; 00:00:15,000</span> 这样的时间轴）。
                自动转写不灵的时候，这里永远是最后一条路。
              </label>
            )}
            <textarea
              id="caption-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-ink-500/70 bg-ink-900 p-3 text-xs leading-5 text-ink-100 outline-none focus:border-teal-400"
              placeholder={youtube ? "0:00\n第一句话\n0:04\n第二句话" : "1\n00:00:00,000 --> 00:00:03,200\n第一句话"}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || draft.trim().length === 0}
                onClick={submitDraft}
                className="min-h-11 flex-1 rounded-xl bg-teal-400 text-sm font-semibold text-teal-950 disabled:opacity-50"
              >
                {busy ? "正在存…" : "存下这份字幕"}
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
                取消
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
                正在生成字幕{percent != null ? `（${percent}%）` : "…"}第一段大约二十秒后出来。
              </p>
            ) : generation?.error ? (
              <p role="alert" className="text-xs leading-5 text-red-400">
                {generation.error}
              </p>
            ) : youtube ? (
              <p className="text-xs leading-5 text-ink-500">
                点<span className="text-ink-300">「生成字幕」</span>一键自动生成（约二十秒）。在电脑上打开、这视频有 CC 的话，也可以「粘贴字幕」免费拿。
              </p>
            ) : (
              <p className="text-xs leading-5 text-ink-500">还没有字幕。</p>
            )}

            {!generation?.running && (
              // 手机上「显示转录」没入口，粘贴基本只对电脑用户成立（D30/D28）。
              // 所以「生成字幕」（一键，命中缓存则免费）永远是主按钮，粘贴降为次选。
              <div className="flex flex-wrap gap-2">
                {generation && (
                  <button
                    type="button"
                    onClick={generation.onRun}
                    className="min-h-11 flex-1 rounded-xl bg-teal-400 px-4 text-sm font-semibold text-teal-950"
                  >
                    {generation.error ? "重试" : generation.resumable ? "继续生成" : "生成字幕"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPasting(true)}
                  className="min-h-11 rounded-xl border border-ink-700 px-4 text-sm text-ink-300"
                >
                  {youtube ? "粘贴字幕" : "手动粘贴"}
                </button>
              </div>
            )}
          </div>
        )
      ) : !on ? null : (
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
                label={autoScan ? "关掉 AI 自动标词" : "打开 AI 自动标词，并马上扫这一片"}
              />
              <label htmlFor="autoscan-toggle" className="min-w-0 text-[0.68rem] leading-4">
                <span className="text-ink-300">AI 标词</span>
                <span className="ml-1.5 text-ink-500">
                  {scanning
                    ? "正在扫这一片…"
                    : autoScan
                      ? "开着，会把值得收的词标出来"
                      : "关着（开了要花钱，每片只扫一次）"}
                </span>
              </label>
            </div>
          )}

          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-[0.68rem] text-ink-500">字号</span>
            <input
              ref={attachSlider}
              type="range"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={1}
              defaultValue={SIZE_DEFAULT}
              aria-label="字幕字号"
              onChange={(e) => {
                const next = Number(e.target.value);
                applySize(next);
                try {
                  localStorage.setItem(SIZE_KEY, String(next));
                } catch {
                  // 存不进不致命，下次回默认字号
                }
              }}
              className="h-6 flex-1 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-ink-700 [&::-webkit-slider-thumb]:mt-[-0.4rem] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-teal-400 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-teal-400 [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-ink-700"
            />
            <span ref={labelRef} className="ui-mono text-[0.68rem] text-ink-500">
              {SIZE_DEFAULT}px
            </span>
          </div>

          {/* M2.9 双语字幕：选语言（默认关闭）+ flip 对调大小 + 只当前行 + 进度 */}
          <div className="mt-2 flex flex-wrap items-center gap-2 px-1 text-[0.68rem]">
            <span className="text-ink-500">译文</span>
            <select
              value={lang}
              onChange={(e) => pickLang(e.target.value)}
              aria-label="译文语言"
              className="h-8 rounded-lg border border-ink-700 bg-ink-900 px-2 text-ink-100 outline-none focus:border-teal-400"
            >
              <option value="">关闭</option>
              {TARGET_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            {lang && (
              <>
                <button
                  type="button"
                  onClick={toggleFlip}
                  aria-label="对调原文与译文的大小"
                  className="h-8 rounded-lg px-2 text-ink-300 hover:text-teal-300"
                >
                  {flip ? "译文大 ⇅" : "原文大 ⇅"}
                </button>
                <button
                  type="button"
                  onClick={toggleOnlyCurrent}
                  aria-pressed={trOnlyCurrent}
                  className={`h-8 rounded-lg px-2 transition-colors ${
                    trOnlyCurrent ? "text-teal-300" : "text-ink-500 hover:text-ink-300"
                  }`}
                >
                  {trOnlyCurrent ? "只当前行" : "每行译文"}
                </button>
                {trRunning && (
                  <span className="ui-mono text-teal-300/80">
                    翻译中{trPercent != null ? ` ${trPercent}%` : "…"}
                  </span>
                )}
              </>
            )}
            {trNote && !trRunning && <span className="text-ink-400">{trNote}</span>}
          </div>

          {/* M3.10 / D45：字幕列表是划词的**第二个入口** —— D39 把暂停面板收成细条，
              为的就是往回翻着划。手势不说出口就等于没做（创始人上一轮真机反馈的原话是
              「我好像没看到重新扫描在哪里」），所以这行小字必须在 */}
          {onToggleTerm && (
            <p className="mt-2 text-[0.68rem] leading-4 text-ink-500">
              {COPY.pickHint}
            </p>
          )}
          <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-ink-700 p-2">
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
                      aria-label={`跳到 ${mmss(seg.start)}`}
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
                        aria-label={`跳到 ${mmss(seg.start)}`}
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

        </>
      )}

      {/* 转到一半停了（预算用完 / 中途出错）—— 字幕已经有一截，但别让用户
          以为"就这么多了"。给一句话说清楚 + 一个接着来的按钮。
          **刻意放在开关之外**：创始人真机撞到过 —— 把字幕收起来之后，
          这个按钮跟着一起没了，于是"生成了一半"就成了一个走不出去的死角。 */}
      {hasCaptions && generation && !generation.running && (generation.resumable || generation.error) && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-ink-700 px-3 py-2">
          <p className="flex-1 text-[0.68rem] leading-4 text-ink-500">
            {generation.error || "后面还有没转完的部分。"}
          </p>
          <button
            type="button"
            onClick={generation.onRun}
            className="min-h-9 shrink-0 rounded-lg border border-teal-400/50 px-3 text-xs text-teal-300"
          >
            {generation.error ? "重试" : "继续生成"}
          </button>
        </div>
      )}
    </section>
  );
}

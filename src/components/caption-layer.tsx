"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { activeSegmentIndex, parseTranscript } from "@/lib/captions";
import { mmss } from "@/lib/time";
import type { TranscriptSegment } from "@/lib/types";

// M1d — 字幕层（D4）：开关 + 字号 14–28px（存 localStorage）+ 行宽自适应（.caption-copy）
// + 跟着播放走的高亮。点某一句 = 跳到那一句，跟点点条同一个手感。
//
// M1 阶段字幕靠手贴（.srt / .vtt），目的是**先把渲染与同步验对**；
// M2 的自动转写写同一个字段、同一个形状，这个组件届时一个字都不用改。

const SIZE_KEY = "fermata.captions.size";
const SIZE_MIN = 14;
const SIZE_MAX = 28;
const SIZE_DEFAULT = 18;

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
}

export function CaptionLayer({
  sourceId,
  transcript,
  kind,
  getCurrentTime,
  onSeek,
  generation,
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

          <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-ink-700 p-2">
            <ul className="caption-copy flex flex-col">
              {segments.map((seg, i) => {
                const isActive = i === active;
                return (
                  <li key={`${seg.start}-${i}`} ref={isActive ? activeRef : null}>
                    <button
                      type="button"
                      onClick={() => onSeek(seg.start)}
                      className={`flex w-full gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${
                        isActive ? "bg-ink-700/60 text-ink-100" : "text-ink-500 hover:text-ink-300"
                      }`}
                    >
                      <span className="ui-mono shrink-0 pt-0.5 text-[0.68rem] text-ink-500">
                        {mmss(seg.start)}
                      </span>
                      <span style={{ fontSize: "var(--caption-size)", lineHeight: 1.5 }}>
                        {seg.text}
                      </span>
                    </button>
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

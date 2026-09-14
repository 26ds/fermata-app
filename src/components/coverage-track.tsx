"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useCopy } from "@/components/copy-provider";
import { mmss } from "@/lib/time";
import {
  coverageSegments,
  coverageTier,
  type CoverageSeg,
  type CoverageSource,
} from "@/lib/watch-events";

// M3.15 片 c0 —— 「看了几遍」的填色（D71：推翻 D66 的后半句，要画）。两处用同一套：
// 捕获轴（DotBar 里那条 8px 的轨）和互动记录顶上那条（更高、可悬停、点一段跳到那段开头）。
//
// ── 颜色（D73，2026-09-13 改的）──────────────────────────────────────────
// 片 c0 用的是 ink 灰阶三档（越亮看得越多）。创始人真机看了说「颜色不对不够明显」——
// 灰轨上画三档灰，一眼读不出「这一截是看过的」。他给的方向：「换一种绿色 然后越来越深就行，
// 然后和那个点的颜色错开，然后没看过的就是原来的颜色」。所以：
// **没看过 = 轨道底色 ink-700（不变）；看过 1 / 2 / 3 遍及以上 = leaf-300 / 500 / 700，越深看得越多。**
// 叶绿是偏黄的绿，捕获点是青色（薄荷绿）—— 色相拉开，颜色一物一义照旧成立（D71）：
// 青色只答「这是个捕获点」，绿色只答「这儿看过几遍」。
// 片 c0 否掉青色那套的理由是「看一遍的 teal-950 比没看过的底色还暗，像被挖了个洞」——
// 这一套最深那档 leaf-700 的亮度也还是底色的两倍左右，每一档对底色都有亮度差 + 色相差，不会倒挂。
const TIER_BG = ["", "bg-leaf-300", "bg-leaf-500", "bg-leaf-700"] as const;
/** 图例（互动记录顶上）用的色块 —— 和填色同一套，别各写各的 */
export const TIER_SWATCH = TIER_BG;

const pct = (x: number) => `${Math.min(100, Math.max(0, x * 100))}%`;

/**
 * 捕获轴那条轨里面的填色。**全页只有它**会在播放时每秒被叫醒一次（边看边长，D71：1–2 秒一次、只动轴那一小块），
 * 不会带着整个观看页重渲染 —— 它自己订记录器，watch-stage 那一层一个 state 都不多。
 */
export function CoverageFill({ source, durationS }: { source: CoverageSource; durationS: number }) {
  const snap = useSyncExternalStore(source.subscribe, source.getCoverage, source.getCoverage);
  const segs = useMemo(() => coverageSegments(snap, durationS), [snap, durationS]);
  return (
    <>
      {segs.map((s) =>
        s.n > 0 ? (
          <div
            key={`${s.from}:${s.n}`}
            className={`absolute inset-y-0 ${TIER_BG[coverageTier(s.n)]}`}
            style={{ left: pct(s.from / durationS), width: pct((s.to - s.from) / durationS) }}
          />
        ) : null,
      )}
    </>
  );
}

/**
 * 「现在在哪」那根针（D73，创始人 2026-09-13：「应该加一个用户现在在哪里的一个针随着这个在动的进度条」）。
 *
 * **不进 React state**：每 250ms 直接改 `style.left` —— 和 dot-bar 两颗箭头同一个脾气。
 * 进 state 就是每秒四次重渲染整条轴（在互动记录里还连着整栏），M0.5 栽过。
 * 位置直接问播放器（`getTime`），不问记录器：停着、刚跳完，针都在该在的地方。
 * 白色 + 一圈深色描边：浅绿、深绿、灰底上都认得出，也不和青色的点抢颜色。
 * `pointer-events-none`：压在轨上、圆点底下，一下都不许挡。
 */
export function PlayheadNeedle({
  getTime,
  durationS,
  className = "",
}: {
  getTime: () => number;
  durationS: number;
  /** 竖直方向怎么摆（各处的轨高度不一样），横向定位这里管 */
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!(durationS > 0)) return;
    const apply = () => {
      const el = ref.current;
      if (el) el.style.left = pct(getTime() / durationS);
    };
    apply();
    const timer = window.setInterval(apply, 250);
    return () => window.clearInterval(timer);
  }, [getTime, durationS]);
  if (!(durationS > 0)) return null;
  return (
    <span
      ref={ref}
      aria-hidden
      data-playhead=""
      className={`pointer-events-none absolute w-0.5 -translate-x-1/2 rounded-full bg-ink-100 shadow-[0_0_0_1px_var(--color-ink-900)] ${className}`}
      style={{ left: "0%" }}
    />
  );
}

/**
 * 互动记录顶上那条：和捕获轴**同一个函数算的同一份数据**，只是更高、每一截都能悬停和点。
 * 悬停一截看得到「04:00–05:10 · 看了 3 遍」，点一截跳到那截开头（照样立返回牌、记一行）。
 *
 * 对读屏藏起来、也不占 Tab 键：同样的信息下面的字里都有（看过多少、回看最多、跳过哪），
 * 几十个无名小方块挨个念出来只是噪音 —— 这一条是给鼠标的快捷方式。
 */
export function CoverageBar({
  segs,
  durationS,
  onJump,
  getTime,
}: {
  segs: readonly CoverageSeg[];
  durationS: number;
  onJump: (s: number) => void;
  /** 传了就画「现在在哪」那根针（D73）。这一栏藏着的时候别传 —— 藏着还每 250ms 挪一次针，白费 */
  getTime?: () => number;
}) {
  const t = useCopy();
  if (!(durationS > 0)) return null;
  return (
    // 外面这层不裁切：针比轨高出上下各 4px；里面那层 `overflow-hidden` 只管圆角
    <div aria-hidden className="relative mt-1.5">
      <div className="relative h-3 overflow-hidden rounded-full bg-ink-700">
        {segs.map((s) => (
          <button
            key={`${s.from}:${s.n}`}
            type="button"
            tabIndex={-1}
            title={`${mmss(s.from)}–${mmss(s.to)} · ${s.n > 0 ? t("act.segWatched", s.n) : t("act.segUnwatched")}`}
            onClick={() => onJump(s.from)}
            className={`absolute inset-y-0 cursor-pointer hover:ring-1 hover:ring-inset hover:ring-teal-300 ${TIER_BG[coverageTier(s.n)]}`}
            style={{ left: pct(s.from / durationS), width: pct((s.to - s.from) / durationS) }}
          />
        ))}
      </div>
      {getTime ? <PlayheadNeedle getTime={getTime} durationS={durationS} className="-bottom-1 -top-1" /> : null}
    </div>
  );
}

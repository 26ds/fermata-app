"use client";

import { useMemo, useSyncExternalStore } from "react";
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
// ── 颜色一物一义（开工先量第 3 条：在 lab 页上把几套都画出来看过才定的） ──────────
// 青色已经在答「这是不是一个捕获点」（`bg-teal-400` 的圆点），所以填色**不用青色**。
// 实测青色那套（teal-950 / 800 / 600）还有一个事先没想到的毛病：
// **看过 1 遍的 teal-950 比没看过的底色 ink-700 还暗** —— 看一遍的地方像被挖了个洞，读起来是反的。
// ink 这一族是对的方向：**越亮 = 看得越多**，而青点在每一档上都靠色相认得出来
// （最亮那档上再加一圈深色描边，描边在 dot-bar.tsx 里）。
const TIER_BG = ["", "bg-ink-500", "bg-ink-300", "bg-ink-100"] as const;

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
}: {
  segs: readonly CoverageSeg[];
  durationS: number;
  onJump: (s: number) => void;
}) {
  const t = useCopy();
  if (!(durationS > 0)) return null;
  return (
    <div aria-hidden className="relative mt-1.5 h-3 overflow-hidden rounded-full bg-ink-700">
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
  );
}

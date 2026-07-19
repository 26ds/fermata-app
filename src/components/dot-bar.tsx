"use client";

import { mmss } from "@/lib/time";
import type { InterruptRow } from "@/lib/types";

// M1c — 点点条：每个捕获点按 t_s / duration 的百分比落在轨道上，点一下跳回去。
// 它只认 t_s 和总时长，不知道底下播的是 YouTube 还是播客 —— 1d 接播客时这里零改动。

/** 点点条只需要这几个字段 */
export type InterruptPoint = Pick<InterruptRow, "id" | "t_s" | "question_mode">;

interface DotBarProps {
  points: InterruptPoint[];
  /** 总时长（秒）。0 表示播放器还没报出来 */
  durationS: number;
  onSeek(t: number): void;
}

export function DotBar({ points, durationS, onSeek }: DotBarProps) {
  const sorted = [...points].sort((a, b) => a.t_s - b.t_s);
  const ready = durationS > 0;

  return (
    <section aria-labelledby="dotbar-title">
      <div className="flex items-center justify-between px-1">
        <p id="dotbar-title" className="eyebrow">
          captures / 捕获点
        </p>
        <span className="ui-mono text-[0.68rem] text-ink-500">
          {sorted.length ? `${sorted.length} 个` : "还没有"}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-dashed border-ink-700 px-4 py-3 text-xs leading-5 text-ink-500">
          播到卡住的地方，点一下悬浮球 —— 这里会留下一个点，随时点回去。
        </p>
      ) : !ready ? (
        <p className="mt-2 rounded-2xl border border-dashed border-ink-700 px-4 py-3 text-xs leading-5 text-ink-500">
          读取时长中，马上就能显示这 {sorted.length} 个点。
        </p>
      ) : (
        // 命中区 44px；左右各留半个身位，免得两端的点把页面撑出横向滚动条
        <div className="mt-2 px-6">
          <div className="relative h-11">
            <div
              className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700"
              aria-hidden
            />
            {sorted.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSeek(p.t_s)}
                title={mmss(p.t_s)}
                aria-label={`跳回 ${mmss(p.t_s)}`}
                className="group absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{
                  left: `${Math.min(100, Math.max(0, (p.t_s / durationS) * 100))}%`,
                }}
              >
                <span
                  className="teal-halo h-2.5 w-2.5 rounded-full bg-teal-400 transition-transform group-hover:scale-150 group-active:scale-125"
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

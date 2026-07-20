"use client";

import { useState } from "react";
import { mmss } from "@/lib/time";
import type { InterruptRow } from "@/lib/types";

// M1c — 点点条：每个捕获点按 t_s / duration 的百分比落在轨道上，点一下跳回去。
// 它只认 t_s 和总时长，不知道底下播的是 YouTube 还是播客 —— 1d 接播客时这里零改动。
//
// 1c-fix / D19：点开一个点会 ① 跳回去 ② 露出删除入口；
// 相距 ≤10s 的点在轨道上必然叠在一起，点中任意一个会在下方展开整簇供精确点选。

/** 点点条只需要这几个字段 */
export type InterruptPoint = Pick<InterruptRow, "id" | "t_s" | "question_mode">;

/** 相距不超过这么多秒的点算同一簇（D19 创始人定的口径） */
const CLUSTER_GAP_S = 10;

interface Cluster {
  /** 簇里第一个点的 id，仅用于 React key */
  key: string;
  /** 簇的落点：取簇首时间 */
  tS: number;
  points: InterruptPoint[];
}

/**
 * 链式合并：只要与簇里**上一个点**的间隔 ≤10s 就并进去。
 * 用"与前一个点"而不是"与簇首"比较 —— 每 8 秒点一次的连续捕获，
 * 在轨道上本来就是叠成一坨的，理应算一簇。
 */
function clusterPoints(sorted: InterruptPoint[]): Cluster[] {
  const out: Cluster[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    const prev = last?.points[last.points.length - 1];
    if (last && prev && p.t_s - prev.t_s <= CLUSTER_GAP_S) {
      last.points.push(p);
    } else {
      out.push({ key: p.id, tS: p.t_s, points: [p] });
    }
  }
  return out;
}

interface DotBarProps {
  points: InterruptPoint[];
  /** 总时长（秒）。0 表示播放器还没报出来 */
  durationS: number;
  onSeek(t: number): void;
  onDelete(id: string): Promise<void>;
}

export function DotBar({ points, durationS, onSeek, onDelete }: DotBarProps) {
  // 记住"用户点开的是哪个点"而不是"哪个簇" —— 簇是算出来的，
  // 删掉一个点整个簇的构成就变了，记簇会让展开层莫名其妙地关掉。
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const sorted = [...points].sort((a, b) => a.t_s - b.t_s);
  const ready = durationS > 0;
  const clusters = clusterPoints(sorted);
  const open = anchorId ? clusters.find((c) => c.points.some((p) => p.id === anchorId)) : undefined;

  function toggle(cluster: Cluster) {
    if (open?.key === cluster.key) {
      setAnchorId(null);
      return;
    }
    setError("");
    setAnchorId(cluster.points[0].id);
    // 单个点：点一下就该跳回去（D19 第一条）。
    // 一簇多个点：跳哪个是不明确的，先展开让用户挑，别擅自跳。
    if (cluster.points.length === 1) onSeek(cluster.points[0].t_s);
  }

  async function remove(id: string) {
    setBusyId(id);
    setError("");
    try {
      await onDelete(id);
      // 删掉的正好是锚点 → 把锚点让给同簇里还活着的点，展开层别整个塌掉
      if (id === anchorId) {
        const survivor = open?.points.find((p) => p.id !== id);
        setAnchorId(survivor?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "没删掉，请重试");
    } finally {
      setBusyId(null);
    }
  }

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
        <>
          {/* 命中区 44px；左右各留半个身位，免得两端的点把页面撑出横向滚动条 */}
          <div className="mt-2 px-6">
            <div className="relative h-11">
              <div
                className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700"
                aria-hidden
              />
              {clusters.map((c) => {
                const many = c.points.length > 1;
                const isOpen = open?.key === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggle(c)}
                    aria-expanded={isOpen}
                    aria-label={
                      many
                        ? `${mmss(c.tS)} 附近的 ${c.points.length} 个捕获点，展开选择`
                        : `跳回 ${mmss(c.tS)}`
                    }
                    className="group absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                    style={{
                      left: `${Math.min(100, Math.max(0, (c.tS / durationS) * 100))}%`,
                    }}
                  >
                    <span
                      className={`teal-halo rounded-full bg-teal-400 transition-transform group-hover:scale-150 group-active:scale-125 ${
                        many ? "h-3 w-3 ring-2 ring-teal-400/40" : "h-2.5 w-2.5"
                      } ${isOpen ? "scale-150 ring-2 ring-teal-200" : ""}`}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {open && (
            <div className="mt-1 rounded-2xl border border-ink-700 bg-ink-900/40 p-2">
              {open.points.length > 1 && (
                <p className="px-2 pb-1 pt-0.5 text-[0.68rem] text-ink-500">
                  这里挤了 {open.points.length} 个点，挑一个：
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {open.points.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSeek(p.t_s)}
                      className="flex min-h-11 flex-1 items-center gap-2 rounded-xl px-3 text-left transition-colors hover:bg-ink-700/60"
                    >
                      <span className="text-teal-300" aria-hidden>
                        ↩
                      </span>
                      <span className="ui-mono text-sm text-ink-100">{mmss(p.t_s)}</span>
                      <span className="text-xs text-ink-500">跳回这里</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => remove(p.id)}
                      aria-label={`删除 ${mmss(p.t_s)} 这个点`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ink-700 text-ink-500 transition-colors hover:border-red-400/60 hover:text-red-300 disabled:opacity-40"
                    >
                      {busyId === p.id ? "…" : "✕"}
                    </button>
                  </li>
                ))}
              </ul>
              {error && (
                <p role="alert" className="px-2 pt-1 text-xs leading-5 text-teal-300">
                  {error}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

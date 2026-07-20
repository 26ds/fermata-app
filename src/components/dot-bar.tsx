"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * 判断"上/下一个"时的容差。
 * 刚跳到某个点上时 currentTime ≈ 该点，差半秒才算"另一个点"，
 * 否则连点两下"下一个"会卡在原地。
 */
const STEP_EPS_S = 0.5;

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

/**
 * 上/下一个捕获点的小三角。刻意做成"透明 UI"：无边框、无底色，
 * 平时压得很淡，按不动时更淡 —— 它是辅助手段，不该跟捕获点本身抢注意力。
 * 命中区仍是 44px 高，拇指够得着。
 */
function NavArrow({
  ref,
  direction,
  onClick,
}: {
  ref: React.Ref<HTMLButtonElement>;
  direction: 1 | -1;
  onClick(): void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={direction === 1 ? "跳到下一个捕获点" : "跳到上一个捕获点"}
      // disabled 与 opacity 刻意都不写进 JSX —— 由 effect 直接改 DOM，见 DotBar 里的说明。
      // 写进来 React 就会在每次重渲染时把它覆盖回去。
      className="relative z-10 flex h-11 w-8 shrink-0 items-center justify-center text-ink-500 transition-opacity hover:text-teal-300 active:text-teal-200 disabled:pointer-events-none"
    >
      <svg viewBox="0 0 10 12" className="h-3 w-2.5" aria-hidden>
        <path d={direction === 1 ? "M0 0 L10 6 L0 12 Z" : "M10 0 L0 6 L10 12 Z"} fill="currentColor" />
      </svg>
    </button>
  );
}

interface DotBarProps {
  points: InterruptPoint[];
  /** 总时长（秒）。0 表示播放器还没报出来 */
  durationS: number;
  /** 现在播到第几秒。左右箭头要靠它算"上/下一个" */
  getCurrentTime(): number;
  onSeek(t: number): void;
  onDelete(id: string): Promise<void>;
}

export function DotBar({ points, durationS, getCurrentTime, onSeek, onDelete }: DotBarProps) {
  // 记住"用户点开的是哪个点"而不是"哪个簇" —— 簇是算出来的，
  // 删掉一个点整个簇的构成就变了，记簇会让展开层莫名其妙地关掉。
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // useMemo 不是为了省这点排序 —— 是为了让下面那个 effect 的依赖稳定下来，
  // 否则每次重渲染都会重建数组、把 500ms 的定时器拆了重装
  const sorted = useMemo(() => [...points].sort((a, b) => a.t_s - b.t_s), [points]);
  const ready = durationS > 0;
  const clusters = useMemo(() => clusterPoints(sorted), [sorted]);
  const open = anchorId ? clusters.find((c) => c.points.some((p) => p.id === anchorId)) : undefined;

  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  /**
   * 左右箭头的可用状态**直接写进 DOM**，不走 state。
   * 它随播放位置一直在变，进 state 就是每 500ms 重渲染一次整条点点条；
   * 而这两个按钮的 `disabled` 从头到尾没写进 JSX，React 也就不会来抢。
   */
  useEffect(() => {
    if (sorted.length === 0) return;
    // 变淡也一起在这里写。不用 Tailwind 的 `disabled:opacity-*`：
    // `disabled` 是我们自己用 JS 设的，再让一条 CSS 伪类规则去跟它对表，
    // 等于把一件事拆到两个地方 —— 出问题时很难看出是谁没生效。
    const set = (el: HTMLButtonElement | null, enabled: boolean) => {
      if (!el) return;
      el.disabled = !enabled;
      el.style.opacity = enabled ? "1" : "0.2";
    };
    const apply = () => {
      const t = getCurrentTime();
      set(prevRef.current, sorted.some((p) => p.t_s < t - STEP_EPS_S));
      set(nextRef.current, sorted.some((p) => p.t_s > t + STEP_EPS_S));
    };
    apply();
    const timer = window.setInterval(apply, 500);
    return () => window.clearInterval(timer);
  }, [sorted, getCurrentTime]);

  /**
   * 跳到上/下一个捕获点。
   *
   * 这才是密集捕获点真正的解药：10 分钟的视频里几十秒内点了好几下，
   * 那几个圆点在轨道上只隔几个像素，手指再准也点不中 —— 而箭头的大小
   * 跟点的疏密无关，永远好按。（集群展开解决"看得清"，箭头解决"够得着"。）
   */
  function step(direction: 1 | -1) {
    const t = getCurrentTime();
    const target =
      direction === 1
        ? sorted.find((p) => p.t_s > t + STEP_EPS_S)
        : [...sorted].reverse().find((p) => p.t_s < t - STEP_EPS_S);
    if (!target) return;
    setError("");
    onSeek(target.t_s);
    // 顺手把它设成锚点：圆点会高亮、下方展开出这个点 —— 用户得知道自己落在哪
    setAnchorId(target.id);
  }

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
          <div className="mt-2 flex items-center">
            {/* 上一个 / 下一个捕获点。透明、无边框，只在能用时才显形（disabled 时压到 15%）。
                z-10：两端圆点的 44px 命中区会探进来一点，箭头必须压在上面 */}
            <NavArrow ref={prevRef} direction={-1} onClick={() => step(-1)} />

            {/* 命中区 44px；左右各留半个身位，免得两端的点把页面撑出横向滚动条 */}
            <div className="min-w-0 flex-1 px-3">
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

            <NavArrow ref={nextRef} direction={1} onClick={() => step(1)} />
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

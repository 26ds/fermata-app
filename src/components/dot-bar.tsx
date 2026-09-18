"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCopy } from "@/components/copy-provider";
import { CoverageFill, PlayheadNeedle } from "@/components/coverage-track";
import { mmss } from "@/lib/time";
import type { InterruptRow } from "@/lib/types";
import type { CoverageSource } from "@/lib/watch-events";

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
  const t = useCopy();

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={direction === 1 ? t("dots.next") : t("dots.prev")}
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

/**
 * 那个问号（创始人 2026-09-06）。原来这一条上面顶着一行 `CAPTURES / 捕获点`，
 * 只为说一个名字就占掉一整行；**名字换成一句人话，藏在问号里**，行让给内容。
 *
 * 悬浮和点击都能打开（他要的是「鼠标悬浮/点击」）：悬浮走 `hover`，
 * 点击走 `pinned` —— 两者分开存，否则触屏上点一下会被紧接着合成的 mouseleave 关掉。
 *
 * **第四轮它搬到了整条的最前面**（创始人 2026-09-06：「这个问号直接提到前面去」）——
 * 右端腾出来给「播放控制」那颗折叠开关。⚠️ 外层刻意**不写 z-index**：
 * 写了就成了层叠上下文，气泡的 `z-20` 只在它自己家里管用，
 * 会被后面那两颗 `z-10` 的箭头压在底下（气泡现在朝右长，正好横穿它们）。
 */
function CaptureHelp({ text, label }: { text: string; label: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  return (
    <div className="relative flex shrink-0 items-center">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onBlur={() => setPinned(false)}
        className="flex h-11 w-7 items-center justify-center text-ink-500 transition-colors hover:text-teal-300"
      >
        <span
          aria-hidden
          className={`flex h-[15px] w-[15px] items-center justify-center rounded-full border text-[0.6rem] leading-none ${
            open ? "border-teal-400 text-teal-300" : "border-current"
          }`}
        >
          ?
        </span>
      </button>
      {open && (
        // 气泡朝**右**上长：问号现在钉在整条的最左端，朝左会顶出屏幕（264px 宽，直接跑到负数去）
        <p className="glass-card absolute bottom-full left-0 z-20 mb-1 w-64 rounded-xl px-3 py-2 text-[0.68rem] leading-5 text-ink-200">
          {text}
        </p>
      )}
    </div>
  );
}

interface DotBarProps {
  points: InterruptPoint[];
  /** 总时长（秒）。0 表示播放器还没报出来 */
  durationS: number;
  /** 现在播到第几秒。左右箭头要靠它算"上/下一个" */
  getCurrentTime(): number;
  /**
   * 跳过去。**第二个参数是「怎么跳的」**（D71：每颗会跳的 Fermata 控件都自报家门）——
   * 点一个点 = `dots`，◀ ▶ = `dots_nav`。互动记录那一行靠它写，D63 的返回牌也靠它判断撤不撤。
   */
  onSeek(t: number, via: "dots" | "dots_nav"): void;
  onDelete(id: string): Promise<void>;
  /**
   * 钉在这一条**最右端**的一个小控件（现在装的是「播放控制」的折叠开关，**且只在折叠时才传**）。
   *
   * 展开时那颗开关长在播放控制卡自己身上（创始人 2026-09-06：「这个隐藏提到那个红圈那里去」
   * —— 开关就该长在它收起来的那个东西上）；卡片一收起来，开关就落到这儿。
   * **第四轮它不再单占一行**（创始人 2026-09-06：「把这一行往上提 然后和播放控制一行」）——
   * 直接进到点点条这一行的末尾，整条因此上移 32.32px（1512×900 实测）。
   *
   * ⚠️ **一个点都没有 / 时长还没读出来时这一行根本不存在**，那时它退回到占位块上面单独一层。
   * 不这么兜的话：新导入一条内容 + 之前收起过控制条 = 开关永远找不回来
   * （卡片是 `lg:hidden`，窄屏那边也没有开关），控制条就此锁死。
   * **外面那层"只在宽屏出现"仍由调用方带来**（开关自己带 `lg:inline-flex`），点点条不认得被折叠的是谁。
   */
  trailing?: React.ReactNode;
  /**
   * M3.15 片 c0（D71）：「看了几遍」的数据源（记录器）。**只在宽屏传** ——
   * 传了，这根 1px 的线就变成 8px 的轨、按遍数填色，圆点加一圈深色描边；
   * 不传（手机），这一条一个像素都不变（D71：只在宽屏画、只在宽屏变粗）。
   */
  coverage?: CoverageSource;
}

export function DotBar({
  points,
  durationS,
  getCurrentTime,
  onSeek,
  onDelete,
  trailing,
  coverage,
}: DotBarProps) {
  const t = useCopy();
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
    if (sorted.length === 0) {
      // 宽屏上一个点都没有时这一行也在（为了画「看了几遍」）—— 两颗箭头无处可去，得是灰的。
      // 手机上 0 个点时这一行根本不存在，两个 ref 都是 null，这里什么都不做
      for (const el of [prevRef.current, nextRef.current]) {
        if (!el) continue;
        el.disabled = true;
        el.style.opacity = "0.2";
      }
      return;
    }
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
    onSeek(target.t_s, "dots_nav");
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
    if (cluster.points.length === 1) onSeek(cluster.points[0].t_s, "dots");
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
      setError(e instanceof Error ? e.message : t("dots.deleteFailed"));
    } finally {
      setBusyId(null);
    }
  }

  // 一个点都没有（或时长还没读出来）时下面那一行不存在，折叠开关只好退回来单占一层。
  // **刻意不写 `mb-*`**：窄屏上开关自己是 `display:none`，这个 div 就是 0 高、0 边距，
  // 一个像素都不占；下面那块占位的 `mt-2` 照旧从这儿量起，窄屏几何原样不动。
  const trailingRow = trailing ? (
    <div className="flex justify-end px-1">{trailing}</div>
  ) : null;

  return (
    // 创始人 2026-09-06：`CAPTURES / 捕获点` 那一行整行拿掉（"甚至直接隐藏"），
    // 这一条整体再往上提一层。名字没有丢 —— 读屏的人从 aria-label 拿到它，
    // 看得见的人从**最左边**那个问号拿到一句更有用的人话。
    //
    // 第四轮（同日）：折叠开关不再单占一行，进到下面这一行的末尾 ——
    // 「把这一行往上提 然后和播放控制一行」。
    <section aria-label={t("watch.captures.aria")}>
      {/* 片 c0：宽屏上时长一读到，**一个点都没有也照样画这一行** —— 「看了几遍」画在这根轴上（D71），
          没有点就不画轴，新导入的内容看多少都看不出来。手机（不传 coverage）照旧是那块虚线框，一个像素不动 */}
      {sorted.length === 0 && !(coverage && ready) ? (
        <>
          {trailingRow}
          <p className="mt-2 rounded-2xl border border-dashed border-ink-700 px-4 py-3 text-xs leading-5 text-ink-500">
            {t("dots.empty")}
          </p>
        </>
      ) : !ready ? (
        <>
          {trailingRow}
          <p className="mt-2 rounded-2xl border border-dashed border-ink-700 px-4 py-3 text-xs leading-5 text-ink-500">
            {t("dots.loading", sorted.length)}
          </p>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center">
            {/* 问号提到整条最前面（创始人 2026-09-06 第四轮）。它是"这些点是什么"的答案，
                站在开头更像一个开场白；右端也就空出来给折叠开关。 */}
            <CaptureHelp text={t("watch.captures.help")} label={t("watch.captures.helpAria")} />

            {/* 上一个 / 下一个捕获点。透明、无边框，只在能用时才显形（disabled 时压到 15%）。
                z-10：两端圆点的 44px 命中区会探进来一点，箭头必须压在上面 */}
            <NavArrow ref={prevRef} direction={-1} onClick={() => step(-1)} />

            {/* 命中区 44px；左右各留半个身位，免得两端的点把页面撑出横向滚动条 */}
            <div className="min-w-0 flex-1 px-3">
              <div className="relative h-11">
              {coverage ? (
                // 片 c0（D71）：**宽屏上**这根线变成 8px 的轨，按「看了几遍」填色 ——
                // 没看过 = 底色、看过 1 / 2 / 3 遍以上 = 越来越深的绿（D73：2026-09-13 从 ink 灰阶换成叶绿，理由见 coverage-track.tsx）。
                // `pointer-events-none`：它压在所有圆点底下，一下都不许挡
                // （开工先量第 2 条：把它故意改成能点，121 个采样点被它挡掉 0 个；44px 的命中区原样在）。
                <div
                  className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-ink-700"
                  aria-hidden
                >
                  <CoverageFill source={coverage} durationS={durationS} />
                </div>
              ) : (
                <div
                  className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700"
                  aria-hidden
                />
              )}
              {/* D73：「现在在哪」那根针 —— 跟着填色一起**只在宽屏**画（手机不传 coverage，这根轴一个像素不动）。
                  排在圆点前面 = 压在圆点底下：播到一个点上时，那个点照样点得中 */}
              {coverage ? (
                <PlayheadNeedle getTime={getCurrentTime} durationS={durationS} className="top-1/2 h-4 -translate-y-1/2" />
              ) : null}
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
                        ? t("dots.clusterAria", mmss(c.tS), c.points.length)
                        : t("dots.jumpAria", mmss(c.tS))
                    }
                    className="group absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                    style={{
                      left: `${Math.min(100, Math.max(0, (c.tS / durationS) * 100))}%`,
                    }}
                  >
                    <span
                      className={`teal-halo rounded-full bg-teal-400 transition-transform group-hover:scale-150 group-active:scale-125 ${
                        many ? "h-3 w-3 ring-2 ring-teal-400/40" : "h-2.5 w-2.5"
                      } ${isOpen ? "scale-150 ring-2 ring-teal-200" : ""} ${
                        // 片 c0：宽屏的轨有了填色，浅色那档（D73 起是 leaf-300）上的青点得有一圈深色描边才认得出
                        // （开工先量第 3 条，lab 页上几套并排看过）。用 outline 不用 ring：不占位置，
                        // 也不和光晕 / 簇的那圈 ring 抢 box-shadow。展开的那颗自己有高亮，不描
                        coverage && !isOpen ? `outline outline-2 outline-ink-900 ${many ? "outline-offset-2" : ""}` : ""
                      }`}
                      aria-hidden
                    />
                  </button>
                );
              })}
              </div>
            </div>

            <NavArrow ref={nextRef} direction={1} onClick={() => step(1)} />

            {/* 个数（从原来那行标题搬下来的），再往右就是折叠开关 —— 它原来自己占一行，
                现在归到这一行的末尾，横坐标几乎没动，整条往上提了一层 */}
            <span className="ui-mono shrink-0 px-1 text-[0.68rem] text-ink-500">
              {t("watch.captures.count", sorted.length)}
            </span>
            {trailing}
          </div>

          {open && (
            <div className="mt-1 rounded-2xl border border-ink-700 bg-ink-900/40 p-2">
              {open.points.length > 1 && (
                <p className="px-2 pb-1 pt-0.5 text-[0.68rem] text-ink-500">
                  {t("dots.crowded", open.points.length)}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {open.points.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSeek(p.t_s, "dots")}
                      className="flex min-h-11 flex-1 items-center gap-2 rounded-xl px-3 text-left transition-colors hover:bg-ink-700/60"
                    >
                      <span className="text-teal-300" aria-hidden>
                        ↩
                      </span>
                      <span className="ui-mono text-sm text-ink-100">{mmss(p.t_s)}</span>
                      <span className="text-xs text-ink-500">{t("dots.jumpHere")}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => remove(p.id)}
                      aria-label={t("dots.deleteAria", mmss(p.t_s))}
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

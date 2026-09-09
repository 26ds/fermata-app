"use client";

import { useEffect, useRef } from "react";
import { useCopy } from "@/components/copy-provider";

// M1 1b：悬浮捕获球。拖到任意边缘（落库 localStorage），轻点 = 记这一刻（打断面板）。
// M3 Phase-2：长按 = 进/出「长问答沉浸聊天」。进入时球从当前停靠位平滑滑到底部正中
// 的 Siri 位（design §B），成为模式锚点 + 退出动作（长按收起）。
//
// 结构必须两层（live-console 踩出来的硬教训）：外层写 transform 归拖动/滑动，
// 内层归视觉（Siri 脉动等）—— 同一节点上 transform 只能有一份。

type OrbState = "pending" | "ready";

interface CaptureOrbProps {
  /** pending = 这一刻还没字幕（灰）；ready = 有字幕（青）。真状态源是 M2 */
  state: OrbState;
  /** 轻点：接打断面板（沉浸态下不触发） */
  onTap: () => void;
  /** 长按达阈值：非沉浸态 = 进入沉浸聊天；沉浸态 = 退出。由父组件按当前模式路由 */
  onLongPress: () => void;
  /** 是否处于沉浸聊天态：true 时球滑到底部正中并变 Siri 位，禁用拖拽/轻点 */
  immersive: boolean;
}

const ORB = 56; // 球径 px，与 live-console 的 h-14 一致
const EDGE = 16; // 离屏幕边缘留白 px
const LONG_PRESS_MS = 500; // 按住这么久 = 长按（与既有阈值一致，design §B/E）
const DRAG_THRESHOLD = 8; // 位移超过它就算拖动，不再是点按/长按
const IMMERSIVE_BOTTOM = 72; // 沉浸态球顶端离屏幕底的 px（球底约 72px，避让 Home 指示条 + 输入条排上方）

const STORAGE_KEY = "fermata-orb-dock";

interface Dock {
  side: "left" | "right";
  y: number; // 球顶端的绝对 px（读取时按当前视口 clamp）
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function loadDock(): Dock {
  const maxY = window.innerHeight - ORB - EDGE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Dock;
      if ((d.side === "left" || d.side === "right") && typeof d.y === "number") {
        return { side: d.side, y: clamp(d.y, EDGE, maxY) };
      }
    }
  } catch {
    // 坏数据 / 隐私模式：忽略，用默认停靠
  }
  // 默认：右侧偏下，拇指够得着又不挡官方控件
  return { side: "right", y: clamp(window.innerHeight * 0.66, EDGE, maxY) };
}

function dockToXY(dock: Dock): { x: number; y: number } {
  const x = dock.side === "left" ? EDGE : window.innerWidth - ORB - EDGE;
  return { x, y: dock.y };
}

export function CaptureOrb({ state, onTap, onLongPress, immersive }: CaptureOrbProps) {
  const t = useCopy();
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // 位置全程走 ref + 直改 DOM：JSX 里不写 transform，React 就不接管它，
  // 重渲染也不会把球弹回原位。dockRef 记住当前停靠点，退出沉浸态时滑回它。
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const dockRef = useRef<Dock | null>(null);

  // 手势期间的临时账本，全走 ref 不触发渲染
  const startRef = useRef({ x: 0, y: 0, baseX: 0, baseY: 0 });
  const movedRef = useRef(false);
  const draggingRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  // 沉浸态永远读最新值（长按计时器在 pointerdown 时设，回调里要判当前模式）
  const immersiveRef = useRef(immersive);
  useEffect(() => {
    immersiveRef.current = immersive;
  }, [immersive]);

  // 首次挂载：恢复停靠点，直接写进 DOM 并显形。位置不参与渲染，就不占 state。
  useEffect(() => {
    const dock = loadDock();
    dockRef.current = dock;
    const xy = dockToXY(dock);
    posRef.current = xy;
    const el = outerRef.current;
    if (el) {
      el.style.transform = `translate(${xy.x}px, ${xy.y}px)`;
      el.style.visibility = "visible"; // 行内盖过初始的 invisible 类
    }
  }, []);

  // 进/出沉浸态：球平滑滑到底部正中 / 滑回原停靠位（design §B/E：连续动画，位置不丢）
  const firstImmersiveRef = useRef(true);
  useEffect(() => {
    if (firstImmersiveRef.current) {
      firstImmersiveRef.current = false;
      if (!immersive) return; // 初始就是非沉浸态：不做无谓的滑动
    }
    const el = outerRef.current;
    if (!el) return;
    if (immersive) {
      const cx = (window.innerWidth - ORB) / 2;
      const cy = window.innerHeight - ORB - IMMERSIVE_BOTTOM;
      el.style.transition = "transform 620ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = `translate(${cx}px, ${cy}px)`;
    } else {
      const xy = dockToXY(dockRef.current ?? loadDock());
      posRef.current = xy;
      el.style.transition = "transform 500ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = `translate(${xy.x}px, ${xy.y}px)`;
    }
    // 滑动结束后清掉 transition —— 否则下次拖动会被动画拖慢发黏
    const id = window.setTimeout(() => {
      if (outerRef.current) outerRef.current.style.transition = "";
    }, 660);
    return () => window.clearTimeout(id);
  }, [immersive]);

  function clearLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const base = posRef.current;
    if (!base) return; // 还没量好位置，先不接手势
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 指针已失效时 capture 会抛错，忽略即可
    }
    startRef.current = { x: e.clientX, y: e.clientY, baseX: base.x, baseY: base.y };
    movedRef.current = false;
    draggingRef.current = false;
    longPressFiredRef.current = false;
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      // 到点还没移动 = 长按：进入或退出沉浸聊天（父组件按当前模式路由）
      if (!movedRef.current) {
        longPressFiredRef.current = true;
        onLongPress();
      }
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (immersiveRef.current) return; // 沉浸态：球固定在 Siri 位，不接受拖动
    if (longPressFiredRef.current) return; // 已触发长按，别再转拖动
    const s = startRef.current;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!draggingRef.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      draggingRef.current = true;
      movedRef.current = true;
      clearLongPress(); // 判定为拖动，取消长按计时
    }
    const maxX = window.innerWidth - ORB - EDGE;
    const maxY = window.innerHeight - ORB - EDGE;
    const x = clamp(s.baseX + dx, EDGE, maxX);
    const y = clamp(s.baseY + dy, EDGE, maxY);
    // 拖动直改 DOM，不 setState —— 每帧重渲染会让手感发黏
    if (outerRef.current) {
      outerRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    clearLongPress();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 忽略
    }
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return; // 长按已处理，不再当轻点
    }
    if (immersiveRef.current) return; // 沉浸态：非长按不做事（轻点/拖动都忽略）
    if (draggingRef.current) {
      draggingRef.current = false;
      const s = startRef.current;
      const maxY = window.innerHeight - ORB - EDGE;
      const rawX = s.baseX + (e.clientX - s.x);
      const y = clamp(s.baseY + (e.clientY - s.y), EDGE, maxY);
      // 吸附到最近的左/右边缘
      const side: "left" | "right" =
        rawX + ORB / 2 < window.innerWidth / 2 ? "left" : "right";
      const dock: Dock = { side, y };
      dockRef.current = dock;
      const xy = dockToXY(dock);
      posRef.current = xy;
      if (outerRef.current) {
        outerRef.current.style.transform = `translate(${xy.x}px, ${xy.y}px)`;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dock));
      } catch {
        // 存不进不致命，下次回默认位
      }
      return;
    }
    // 没拖动、没长按 = 轻点
    onTap();
  }

  function onPointerCancel() {
    // pointercancel 的坐标无意义（常是 0,0）—— 一律回退到手势开始时的基准位，
    // 绝不拿事件坐标算落点（右滑删除就是栽在这上头）。
    clearLongPress();
    longPressFiredRef.current = false;
    if (draggingRef.current && !immersiveRef.current) {
      draggingRef.current = false;
      const s = startRef.current;
      if (outerRef.current) {
        outerRef.current.style.transform = `translate(${s.baseX}px, ${s.baseY}px)`;
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (immersiveRef.current) onLongPress(); // 键盘可达：沉浸态回车 = 退出
      else onTap();
    }
  }

  const isReady = state === "ready";
  const label = immersive
    ? t("orb.immersive")
    : isReady
      ? t("orb.ready")
      : t("orb.pending");

  return (
    // invisible 只管到挂载那一刻：effect 量好位置后写行内 visibility 盖掉它。
    // transform / visibility 都不进 JSX —— React 不接管，就不会覆盖拖动/滑动结果。
    <div
      ref={outerRef}
      className="invisible fixed left-0 top-0 z-50 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        ref={innerRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        onKeyDown={onKeyDown}
        className={`flex h-14 w-14 items-center justify-center rounded-full text-lg shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${
          immersive
            ? "siri-orb text-teal-950"
            : isReady
              ? "teal-halo bg-teal-400 text-teal-950"
              : "bg-ink-500 text-ink-900"
        }`}
      >
        <span aria-hidden>{immersive ? "◉" : isReady ? "◉" : "◌"}</span>
      </div>
    </div>
  );
}

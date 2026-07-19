"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MIC_ACTIVE_RMS,
  micLevelToScale,
  useMicLevel,
} from "@/lib/live/use-mic-level";

// M1 1b：悬浮捕获球。拖到任意边缘（落库 localStorage），长按唤醒聆听态、
// 对着说话球随音量涨落，轻点 = 记这一刻（真正的打断面板是 1c）。
//
// 结构必须两层（live-console 踩出来的硬教训）：外层写 transform 归拖动，
// 内层写独立的 `scale` 属性归音量脉动 —— 同一节点上 transform 只能有一份，
// 拖动的 translate 和音量的 scale 会互相覆盖。

type OrbState = "pending" | "ready";

interface CaptureOrbProps {
  /** pending = 转写准备中（灰）；ready = 字幕就绪（青）。1b 先写死 ready，真状态源是 M2 */
  state: OrbState;
  /** 轻点：1b 无动作，1c 接打断面板 */
  onTap: () => void;
  /** 长按开始：1b 只做视觉 + 占位字幕，真正接语音在 M3 */
  onLongPressStart: () => void;
  /** 长按结束 / 被打断：务必在这里释放任何长按期资源 */
  onLongPressEnd: () => void;
}

const ORB = 56; // 球径 px，与 live-console 的 h-14 一致
const EDGE = 16; // 离屏幕边缘留白 px
const LONG_PRESS_MS = 500; // 按住这么久 = 长按唤醒
const DRAG_THRESHOLD = 8; // 位移超过它就算拖动，不再是点按/长按

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

export function CaptureOrb({
  state,
  onTap,
  onLongPressStart,
  onLongPressEnd,
}: CaptureOrbProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // 位置全程走 ref + 直改 DOM：JSX 里不写 transform / visibility，React 就不
  // 接管这两个属性，重渲染（比如 listening 切换）也不会把球弹回原位。
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const [listening, setListening] = useState(false);

  // 手势期间的临时账本，全走 ref 不触发渲染
  const startRef = useRef({ x: 0, y: 0, baseX: 0, baseY: 0 });
  const movedRef = useRef(false);
  const draggingRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);

  // 首次挂载：恢复停靠点，直接写进 DOM 并显形。位置不参与渲染，就不占 state。
  useEffect(() => {
    const xy = dockToXY(loadDock());
    posRef.current = xy;
    const el = outerRef.current;
    if (el) {
      el.style.transform = `translate(${xy.x}px, ${xy.y}px)`;
      el.style.visibility = "visible"; // 行内盖过初始的 invisible 类
    }
  }, []);

  // 长按期间才开麦；音量写进内层的 scale 属性（外层 transform 留给拖动）
  useMicLevel(listening, (rms) => {
    const el = innerRef.current;
    if (!el) return;
    el.style.scale = micLevelToScale(rms).toFixed(3);
    el.style.opacity = rms > MIC_ACTIVE_RMS ? "1" : "0.9";
  });

  // 松手 / 取消后把脉动复位，别让球停在放大的定格上
  useEffect(() => {
    if (listening) return;
    const el = innerRef.current;
    if (el) {
      el.style.scale = "1";
      el.style.opacity = "1";
    }
  }, [listening]);

  function clearLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // 回调放 ref，endListening 的身份才稳得住（下面的兜底 effect 要依赖它）
  const onLongPressEndRef = useRef(onLongPressEnd);
  useEffect(() => {
    onLongPressEndRef.current = onLongPressEnd;
  }, [onLongPressEnd]);

  const endListening = useCallback(() => {
    if (!longPressActiveRef.current) return;
    longPressActiveRef.current = false;
    setListening(false);
    onLongPressEndRef.current();
  }, []);

  // 兜底：万一 pointerup / pointercancel 没送到（指针捕获失败、切后台、手势被系统截走），
  // 也必须把聆听态收回来 —— 麦克风绝不能悄悄开着（WORKORDER §M1：控成本也保隐私）。
  // 组件卸载时 useMicLevel 自己的 cleanup 会停 track，这里管的是"还挂着但没人管"的情况。
  useEffect(() => {
    if (!listening) return;
    const stop = () => endListening();
    const onHide = () => {
      if (document.visibilityState === "hidden") endListening();
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [listening, endListening]);

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
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      // 到点还没移动 = 长按唤醒
      if (!movedRef.current) {
        longPressActiveRef.current = true;
        setListening(true);
        onLongPressStart();
      }
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = startRef.current;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!draggingRef.current) {
      if (longPressActiveRef.current) return; // 已在聆听态，不转成拖动
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
    if (longPressActiveRef.current) {
      endListening();
      return;
    }
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
    endListening(); // 被打断也要把麦克风还回去
    if (draggingRef.current) {
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
      onTap();
    }
  }

  const isReady = state === "ready";

  return (
    // invisible 只管到挂载那一刻：effect 量好位置后写行内 visibility 盖掉它。
    // transform / visibility 都不进 JSX —— React 不接管，就不会覆盖拖动结果。
    <div
      ref={outerRef}
      className="invisible fixed left-0 top-0 z-50 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* 聆听态占位字幕：1b 只做视觉，真正的逐词转写在 M3 */}
      {listening && (
        <div className="glass pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-full px-3 py-1 text-xs text-ink-100">
          正在聆听…
        </div>
      )}
      <div
        ref={innerRef}
        role="button"
        tabIndex={0}
        aria-label={isReady ? "捕获球：轻点记这一刻，长按说话" : "捕获球：字幕准备中"}
        aria-pressed={listening}
        onKeyDown={onKeyDown}
        style={{ transition: "scale 120ms ease-out" }}
        className={`flex h-14 w-14 items-center justify-center rounded-full text-lg shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${
          isReady ? "teal-halo bg-teal-400 text-teal-950" : "bg-ink-500 text-ink-900"
        } ${listening ? "ring-2 ring-teal-300/80" : ""}`}
      >
        <span aria-hidden>{isReady ? "◉" : "◌"}</span>
      </div>
    </div>
  );
}

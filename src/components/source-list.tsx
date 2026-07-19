"use client";

import { useRef, useState } from "react";
import Link from "next/link";

export interface SourceListItem {
  id: string;
  kind: string;
  title: string | null;
  url: string | null;
  duration_s: number | null;
  last_position_s: number | null;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(h > 0 ? m : m).padStart(2, "0");
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** 露出删除键的宽度（px） */
const REVEAL = 88;
/** 超过这个位移才算"有意横滑"，否则判定为想上下滚页面 */
const AXIS_LOCK = 8;

export function SourceList({ items }: { items: SourceListItem[] }) {
  const [rows, setRows] = useState(items);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // 手势状态放 ref：pointermove 每秒几十次，走 state 会把整个列表重渲染
  const startRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef<"none" | "x" | "y">("none");
  const movedRef = useRef(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef(0);
  const offsetRef = useRef(0);

  /** 收尾：把行停在开或关，并把状态交还给 React */
  function settle(id: string, open: boolean) {
    const node = nodeRef.current;
    nodeRef.current = null;
    axisRef.current = "none";
    if (node) {
      node.style.transition = "";
      node.style.transform = open ? `translateX(${REVEAL}px)` : "translateX(0px)";
    }
    setOpenId(open ? id : null);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, id: string) {
    if (busyId) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    axisRef.current = "none";
    movedRef.current = false;
    nodeRef.current = e.currentTarget;
    baseRef.current = openId === id ? REVEAL : 0;
    offsetRef.current = baseRef.current;
    // 别的行开着就先合上
    if (openId && openId !== id) setOpenId(null);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const node = nodeRef.current;
    if (!node) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    // 先判方向：竖着划就彻底放手，让页面正常滚动
    if (axisRef.current === "none") {
      if (Math.abs(dy) > AXIS_LOCK && Math.abs(dy) > Math.abs(dx)) {
        axisRef.current = "y";
        return;
      }
      if (Math.abs(dx) > AXIS_LOCK) {
        axisRef.current = "x";
        node.style.transition = "none";
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // 指针已经不活跃了（极少数情况）。抓不到就算了，别让整个手势卡死
        }
      } else {
        return;
      }
    }
    if (axisRef.current !== "x") return;

    movedRef.current = true;
    // 只允许往右拉，拉到头就不动了
    offsetRef.current = Math.max(0, Math.min(REVEAL, baseRef.current + dx));
    node.style.transform = `translateX(${offsetRef.current}px)`;
  }

  function onPointerUp(id: string) {
    if (axisRef.current !== "x") {
      nodeRef.current = null;
      return;
    }
    // 用手势过程中记下的位移判断，而不是重新拿事件坐标算
    settle(id, offsetRef.current > REVEAL / 2);
  }

  function onPointerCancel(id: string) {
    if (axisRef.current !== "x") {
      nodeRef.current = null;
      return;
    }
    // 系统把手势收走了（来电、iOS 边缘侧滑、切后台）。
    // cancel 事件的坐标是无意义的 0,0 —— 拿它算位移会把行错误地弹回去，
    // 所以这里只回到手势开始前的状态。
    settle(id, baseRef.current === REVEAL);
  }

  async function remove(id: string) {
    setBusyId(id);
    setError("");
    const snapshot = rows;
    // 先从界面拿掉，失败再放回来 —— 手机上等一个网络往返太难受
    setRows((prev) => prev.filter((r) => r.id !== id));
    setOpenId(null);
    try {
      const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRows(snapshot);
        setError(data?.error ?? "删除失败，请重试");
      }
    } catch {
      setRows(snapshot);
      setError("网络不通，没能删掉");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-500">
        还没有导入过内容。上面贴一条链接试试。
      </p>
    );
  }

  return (
    <>
      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <ul className="mt-2 flex flex-col">
        {rows.map((s) => {
          const open = openId === s.id;
          return (
            <li key={s.id} className="relative overflow-hidden border-b border-ink-700/80">
              <button
                type="button"
                onClick={() => remove(s.id)}
                disabled={busyId === s.id}
                aria-label={`删除 ${s.title ?? "这条内容"}`}
                tabIndex={open ? 0 : -1}
                className="absolute inset-y-0 left-0 flex w-[5.5rem] items-center justify-center bg-red-500/90 text-sm font-semibold text-ink-100"
              >
                删除
              </button>

              <div
                data-row-id={s.id}
                onPointerDown={(e) => onPointerDown(e, s.id)}
                onPointerMove={onPointerMove}
                onPointerUp={() => onPointerUp(s.id)}
                onPointerCancel={() => onPointerCancel(s.id)}
                style={{ transform: open ? `translateX(${REVEAL}px)` : "translateX(0px)" }}
                // pan-y：竖向滚动交还给浏览器，横向留给我们自己处理
                className="relative touch-pan-y bg-ink-900 transition-transform duration-200 ease-out"
              >
                <Link
                  href={`/watch/${s.id}`}
                  onClick={(e) => {
                    // 刚划完手指，那不是想点开
                    if (movedRef.current || open) {
                      e.preventDefault();
                      if (open) setOpenId(null);
                    }
                  }}
                  className="flex min-h-14 items-center gap-3 py-3 text-sm hover:text-teal-300"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-700 text-ink-300" aria-hidden>
                    ▷
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink-100">
                      {s.title ?? s.url ?? "未命名内容"}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                      <span>{s.kind}</span>
                      {s.duration_s ? <span>{mmss(s.duration_s)}</span> : null}
                      {s.last_position_s && s.last_position_s > 5 ? (
                        <span className="ui-mono text-teal-300">
                          watched to {mmss(s.last_position_s)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-ink-500" aria-hidden>›</span>
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-center text-xs text-ink-500">往右滑一条可以删除</p>
    </>
  );
}

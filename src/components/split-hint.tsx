"use client";

import { useEffect, useRef, useState } from "react";

// M3.15 片 g4 —— 可拖的缝上那颗「i」。
//
// 创始人 2026-09-24：「“Double-click the line，。。” 这个应该有一个i 然后鼠标浮在上面或者点击 就会让用户知道双击的作用」。
// 缝本身只有 1px 一根线，「能拖、双击复位、键盘也行」这几件事从外表上一件都看不出来 —— 这颗 i 就是说明书。
//
// - **悬停 i** 就出说明；**点一下 i** 说明钉住，点别处或按 Esc 收起（触控板上悬停不方便）；
//   **键盘把焦点移到缝上**时也出（外面那条缝是 `group`，这里跟着它的 `focus-visible`）。
// - 读屏不用这颗 i：说明挂在缝的 `aria-describedby` 上（藏着的元素照样念得到），i 自己 `aria-hidden`。
// - **按 i 不许开始拖、双击 i 不许复位**：缝的 `onPointerDown` / `onDoubleClick` 在外层，这里把事件拦下。
// - 只有这颗 i 自己有 state —— 点它只重画它，不重画整个观看页（修补轮的 INP 教训）。

export function SplitHint({ id, text, side }: { id: string; text: string; side: "right" | "top" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="group/hint relative flex"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* 不是 `<button>`：按钮一点就拿到焦点，而它对读屏是藏着的（`aria-hidden`）—— Chrome 会报「藏着的元素拿着焦点」。
          它只给看得见的人用；键盘和读屏走外面那条缝（焦点在缝上就出说明、`aria-describedby` 念说明） */}
      <span
        aria-hidden
        onClick={() => setOpen((v) => !v)}
        className={`ui-mono flex h-4 w-4 cursor-help select-none items-center justify-center rounded-full border bg-ink-900 text-[0.6rem] leading-none transition-colors ${
          open ? "border-teal-400 text-teal-300" : "border-ink-500 text-ink-300 hover:border-teal-400 hover:text-teal-300"
        }`}
      >
        i
      </span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-[60] w-60 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-left text-[0.7rem] leading-[1.45] text-ink-100 shadow-lg ${
          open ? "block" : "hidden group-hover/hint:block group-focus-visible:block"
        } ${side === "right" ? "left-full top-1/2 ml-2 -translate-y-1/2" : "bottom-full left-1/2 mb-2 -translate-x-1/2"}`}
      >
        {text}
      </span>
    </span>
  );
}

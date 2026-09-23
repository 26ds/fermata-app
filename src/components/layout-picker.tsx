"use client";

import { useSyncExternalStore } from "react";
import { useCopy } from "@/components/copy-provider";
import { WATCH_LAYOUTS, type LayoutStore, type WatchLayout } from "@/lib/watch-layout";

// M3.15 片 g —— 布局选择器（计划 §D / **D67**：「都做出来吧……让用户自己选！」）。
//
// 放在字幕栏的头上（他指定的位置是「AI 标词」旁边 —— 片 g 起「AI 标词」收进了同一行的齿轮里，所以就挨着齿轮）。
// **只在宽屏出现**（`hidden lg:flex`）：窄屏只有一种排法，而且改窄屏要单独立项（D78 之后手机也进不来）。
//
// 只画图标、不写字：字幕栏头上这一行在 1280 宽的笔记本上只有 434px，还要放「跟随中」「隐藏」和齿轮 ——
// 写上字就折行。名字和一句说明在悬停提示和读屏名字里（`title` / `aria-label`），一个都没丢。
//
// ⚠️ **这里只订仓库、只重画自己**：点一下只改一个小仓库（`lib/watch-layout.ts`），
// grid 上那个属性由 watch-stage 直接写 DOM —— 切布局不许整页重画（修补轮的 INP 教训）。

function LayoutIcon({ kind }: { kind: WatchLayout }) {
  // 16×12 的小示意图：大框 = 视频，横线 = 字幕，右边那条竖框 = 问答栏
  return (
    <svg viewBox="0 0 16 12" className="h-3 w-4 shrink-0" aria-hidden focusable="false">
      <rect x="0.6" y="0.6" width="14.8" height="10.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      {kind === "focus" ? (
        <>
          {/* ① 视频在左；右栏上半是字幕（三条横线），下半是问答 */}
          <rect x="2" y="2" width="6.6" height="4.4" rx="0.6" fill="currentColor" opacity="0.55" />
          <path d="M10 2.6h4M10 4.3h4M10 6h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <rect x="10" y="7.6" width="4" height="2.6" rx="0.5" fill="none" stroke="currentColor" strokeWidth="0.9" />
        </>
      ) : (
        <>
          {/* ② 视频在左、字幕三行在视频下面；右栏整条是问答 */}
          <rect x="2" y="2" width="6.6" height="4.4" rx="0.6" fill="currentColor" opacity="0.55" />
          <path d="M2.2 7.8h6.2M2.2 9.6h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <rect x="10" y="2" width="4" height="8.2" rx="0.5" fill="none" stroke="currentColor" strokeWidth="0.9" />
        </>
      )}
    </svg>
  );
}

export function LayoutPicker({ store, onPick }: { store: LayoutStore; onPick: (next: WatchLayout) => void }) {
  const t = useCopy();
  const layout = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  const name: Record<WatchLayout, string> = { focus: t("layout.focus"), narrow: t("layout.narrow") };
  const hint: Record<WatchLayout, string> = { focus: t("layout.focusHint"), narrow: t("layout.narrowHint") };
  return (
    <div role="radiogroup" aria-label={t("layout.aria")} className="hidden items-center rounded-lg border border-ink-700 p-0.5 lg:flex">
      {WATCH_LAYOUTS.map((l) => {
        const on = layout === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={name[l]}
            title={`${name[l]} —— ${hint[l]}`}
            onClick={() => onPick(l)}
            className={`flex h-6 w-7 items-center justify-center rounded-md transition-colors ${
              on ? "bg-teal-400/15 text-teal-300" : "text-ink-500 hover:text-ink-300"
            }`}
          >
            <LayoutIcon kind={l} />
          </button>
        );
      })}
    </div>
  );
}

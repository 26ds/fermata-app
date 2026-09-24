"use client";

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { useCopy } from "@/components/copy-provider";
import { createLayoutStore, WATCH_LAYOUTS, type LayoutStore, type WatchLayout } from "@/lib/watch-layout";

// M3.15 片 g —— 布局选择器（计划 §D / **D67**：「都做出来吧……让用户自己选！」）。
//
// **片 g3 起住在页头右上角**（紧挨着「中 / EN」）—— 创始人 2026-09-23：「三种布局的这个按钮一直固定在右上角那一个位置」。
// 原来它长在字幕栏头上，而字幕栏在 ① 里在右上、在 ② 里在视频下面、在 ③ 里在屏幕底：
// **点一下，按钮自己跑到别处去了**，想切回来得先找它。页头是这一页唯一一行不随布局动的地方。
// **只在宽屏出现**（`hidden lg:flex`）：窄屏只有一种排法，而且改窄屏要单独立项（D78 之后手机也进不来）。
//
// 只画图标、不写字：名字和一句说明在悬停提示和读屏名字里（`title` / `aria-label`），一个都没丢。
//
// ⚠️ **这里只订仓库、只重画自己**：点一下只改一个小仓库（`lib/watch-layout.ts`），
// grid 上那个属性由 watch-stage 直接写 DOM —— 切布局不许整页重画（修补轮的 INP 教训）。

interface WatchLayoutContext {
  store: LayoutStore;
  /** 选了一种布局。真正干活的是 watch-stage 的 `chooseLayout`（写 grid 上的属性、记三个栏的滚动位置、存 user_settings） */
  pick: (next: WatchLayout) => void;
  /** watch-stage 挂上 / 卸下时把 `chooseLayout` 交过来 / 收回去 */
  bindChooser: (fn: ((next: WatchLayout) => void) | null) => void;
}

const LayoutCtx = createContext<WatchLayoutContext | null>(null);

/**
 * 片 g3：布局仓库搬到这一层 —— 选择器进了页头，页头在 `<main>` 外面、不在 watch-stage 底下，
 * 两边要拿到**同一个**仓库，就得把它放在两者共同的上面一层（观看页的根）。
 * 服务端渲染照样画得出选中的是哪一种（仓库的初值 = 服务端读到的 `user_settings.watchLayout`），水合前后一致，不闪。
 */
export function WatchLayoutProvider({ initial, children }: { initial: WatchLayout; children: React.ReactNode }) {
  const [value] = useState<WatchLayoutContext>(() => {
    const store = createLayoutStore(initial);
    let chooser: ((next: WatchLayout) => void) | null = null;
    return {
      store,
      // watch-stage 还没挂上（水合那一瞬）就只改仓库 —— 那时 grid 还不存在，没有别的可改
      pick: (next) => (chooser ? chooser(next) : store.set(next)),
      bindChooser: (fn) => {
        chooser = fn;
      },
    };
  });
  return <LayoutCtx.Provider value={value}>{children}</LayoutCtx.Provider>;
}

export function useWatchLayout(): WatchLayoutContext {
  const v = useContext(LayoutCtx);
  if (!v) throw new Error("useWatchLayout 要在 <WatchLayoutProvider> 里面用（观看页的根上包着它）");
  return v;
}

function LayoutIcon({ kind }: { kind: WatchLayout }) {
  // 16×12 的小示意图：大框 = 视频，横线 = 字幕，右边那条竖框 = 问答栏
  return (
    <svg viewBox="0 0 16 12" className="h-3.5 w-[1.2rem] shrink-0" aria-hidden focusable="false">
      <rect x="0.6" y="0.6" width="14.8" height="10.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      {kind === "focus" ? (
        <>
          {/* ① 视频在左；右栏上半是字幕（三条横线），下半是问答 */}
          <rect x="2" y="2" width="6.6" height="4.4" rx="0.6" fill="currentColor" opacity="0.55" />
          <path d="M10 2.6h4M10 4.3h4M10 6h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <rect x="10" y="7.6" width="4" height="2.6" rx="0.5" fill="none" stroke="currentColor" strokeWidth="0.9" />
        </>
      ) : kind === "narrow" ? (
        <>
          {/* ② 视频在左、字幕三行在视频下面；右栏整条是问答 */}
          <rect x="2" y="2" width="6.6" height="4.4" rx="0.6" fill="currentColor" opacity="0.55" />
          <path d="M2.2 7.8h6.2M2.2 9.6h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <rect x="10" y="2" width="4" height="8.2" rx="0.5" fill="none" stroke="currentColor" strokeWidth="0.9" />
        </>
      ) : (
        <>
          {/* ③ 视频在左、问答在右（一样高）；字幕三行横跨整幅、居中，在它们下面 */}
          <rect x="2" y="2" width="6.6" height="4.4" rx="0.6" fill="currentColor" opacity="0.55" />
          <rect x="10" y="2" width="4" height="4.4" rx="0.5" fill="none" stroke="currentColor" strokeWidth="0.9" />
          <path d="M2.4 8h11.2M4 9.8h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * 页头上那颗。长相跟着右边的「中 / EN」走（同一圈 `rounded-full` 描边、同一个高度），站成一排。
 * 选中那一格**不用实心青**：「中 / EN」的选中已经是实心青了，两颗挨着都实心就分不出主次 —— 这里用淡青底 + 青色图标
 */
export function LayoutPicker() {
  const t = useCopy();
  const { store, pick } = useWatchLayout();
  const layout = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  const name: Record<WatchLayout, string> = { focus: t("layout.focus"), narrow: t("layout.narrow"), wide: t("layout.wide") };
  const hint: Record<WatchLayout, string> = {
    focus: t("layout.focusHint"),
    narrow: t("layout.narrowHint"),
    wide: t("layout.wideHint"),
  };
  return (
    <div
      role="radiogroup"
      aria-label={t("layout.aria")}
      className="hidden shrink-0 items-center gap-0.5 rounded-full border border-ink-500/60 p-0.5 lg:flex"
    >
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
            onClick={() => pick(l)}
            className={`flex h-8 w-9 items-center justify-center rounded-full transition-colors ${
              on ? "bg-teal-400/15 text-teal-300" : "text-ink-500 hover:bg-ink-700 hover:text-ink-300"
            }`}
          >
            <LayoutIcon kind={l} />
          </button>
        );
      })}
    </div>
  );
}

// M3.15 片 g —— 观看页宽屏的**布局**（计划 §D / **D67**：几种布局，用户自己选）。
//
// ① `focus`「专注字幕」= 今天的样子：字幕在右栏上半、收在视频下沿，三个栏（问答 / 互动记录 / Takeaway）在它下面；
// ② `narrow`「沉浸 · 窄」= 字幕缩成三行放到**视频下面**（和视频同宽），**右栏整条都给三个栏、一路到屏幕底**。
//    创始人 2026-09-23 要先做布局的原话：「现在chat聊天框看起来还是很小」—— 治小的就是 ② 这一刀（D79）。
// ③ `wide`「沉浸 · 宽」（片 g2）= 字幕三行**横跨整幅**、居中，放在视频和右栏**下面**；右边三个栏收在视频那一栏的下沿；
//    进 ③ 字号自动大一档（计划 §D 第 3 条：行太长的解药是字更大，不是把行掐短 —— 见 caption-layer 的 `WIDE_BUMP`）。
//
// ── 三条规矩（片 g 开工单「最容易做砸的四条」）──────────────────────────────
// ⒜ **切布局时播放器绝对不许换父节点**（换了 = YouTube iframe 重载、视频回到 0，D33 死线）。
//    所以布局只是 grid 容器上的一个 `data-layout` 属性，靠 CSS（`globals.css` 的 `.watch-grid`）换位置，DOM 树一个节点都不动。
// ⒝ **切布局不许整页重画**（修补轮的 INP 教训）：这个值不住在 watch-stage 的 React state 里，住在下面这个小仓库里 ——
//    grid 上那个属性由 watch-stage 直接写 DOM，只有**真的要跟着变长相**的两小块（字幕栏、选择器）订它。
//    片 g3 起仓库住在 `WatchLayoutProvider`（layout-picker.tsx）里 —— 选择器搬进了页头，页头不在 watch-stage 底下。
// ⒞ **选择跟人走**：存 `user_settings.watchLayout`（jsonb 里多一个键，**零迁移**），不存 localStorage（D67：换设备还在）。

export const WATCH_LAYOUTS = ["focus", "narrow", "wide"] as const;
export type WatchLayout = (typeof WATCH_LAYOUTS)[number];

/**
 * 默认 = ②「沉浸 · 窄」—— 创始人 2026-09-23 看过三种布局的真截图后拍的板（「默认是B第二种」）。
 * 计划 §D 原来写的是 ①，这是他的产品决定（D67 补记）。**换默认只改这一行**。
 * 只管**没选过**的人：选过的存在 `user_settings.watchLayout` 里，照旧用他选的那种
 */
export const DEFAULT_WATCH_LAYOUT: WatchLayout = "narrow";

/** 从 `user_settings.settings` 里读。存坏了 / 将来版本存了这一版不认识的值（比如哪天删掉一种布局、库里还存着它）→ 退回默认，不崩 */
export function readWatchLayout(settings: Record<string, unknown>): WatchLayout {
  const v = settings.watchLayout;
  return typeof v === "string" && (WATCH_LAYOUTS as readonly string[]).includes(v) ? (v as WatchLayout) : DEFAULT_WATCH_LAYOUT;
}

/** 一页一个的小仓库（`useSyncExternalStore` 吃的那种）。**方法都是箭头函数，身份永远不变** —— 可以直接当 props 往下递 */
export interface LayoutStore {
  get: () => WatchLayout;
  /** 服务端 / 水合首帧的值 = 进这一页时服务端读到的那个（两边一致，不会水合不一致） */
  getServer: () => WatchLayout;
  set: (next: WatchLayout) => void;
  subscribe: (cb: () => void) => () => void;
}

export function createLayoutStore(initial: WatchLayout): LayoutStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    getServer: () => initial,
    set: (next) => {
      if (next === value) return;
      value = next;
      for (const cb of listeners) cb();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

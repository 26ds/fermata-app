"use client";

import { useSyncExternalStore } from "react";

// M3.15 片 a —— 「现在是不是宽屏」的**唯一入口**。
//
// 为什么需要一个 JS 判据，而不是全靠 `lg:` 类：这一片砍掉的两样东西
// （暂停自动弹面板、悬浮球）**不是"看不见"，是"根本不发生 / 根本不挂载"**。
// 用 `lg:hidden` 藏起来的面板照样会在暂停时打开、照样抢走键盘焦点、
// 照样让 `panelOpenRef` 变 true —— 那不叫砍掉，那叫藏起来（D44 的脾气：
// 别做看着像回事、其实还在背后跑的东西）。
//
// ⚠️ **判据只认窗口宽度，永远不做设备嗅探**（D47①）—— UA 不可靠
// （iPad 在 Safari 里谎报自己是 Mac），而且按宽度走意味着把窗口拉窄
// 就自动退回手机那套，不用维护两份行为。1024 = Tailwind 的 `lg`，
// 和 watch-stage 里那个 `LG_PX` 是同一个数，**改一个就得改另一个**。
//
// 走 useSyncExternalStore 而不是 useEffect 里 setState：
// 同 viewport-layer.tsx / source-list.tsx 的理由 —— 那个写法多一轮级联渲染，
// 而且 `react-hooks/set-state-in-effect` 会直接拦下来。
const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * 同一个判据的**同步版**，给回调用（`handlePause` 之类等不起 state 的地方）。
 * 和 `useIsWide` 共用同一个 media query 串 —— **只有一个判据，不许两处各写一份**
 * （"一个字段两个意思"就是这么长出来的）。⚠️ 只能在浏览器里调。
 */
export const isWideNow = () => window.matchMedia(QUERY).matches;

/**
 * 服务端与水合首帧一律 **false**（＝当成窄屏）。
 *
 * 方向是**故意**这么选的：窄屏那套是"全都在"（悬浮球、暂停面板都挂着），
 * 宽屏那套是"砍掉一些"。首帧当窄屏，水合完再砍，看到的是"多出来的东西闪一下就没了"；
 * 反过来首帧当宽屏，看到的是**手机上悬浮球晚一帧才出现** —— 而手机是创始人真机验收的地方，
 * 那一帧的空窗比宽屏上一闪而过的多余元素更刺眼。
 */
const onServer = () => false;
const onServerWide = () => true;

/** ≥1024px 吗。**只回答宽窄，不回答"是什么设备"** */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribe, isWideNow, onServer);
}

/**
 * 同一个判据，但**服务端与水合首帧一律 true（当成宽屏）**。
 * **只给 `<DesktopOnly>`（D78 的拦截层）用**，别拿去当普通的宽窄判断。
 *
 * 为什么它得和上面那个反着来：拦截层上面那个默认值会让**电脑上先闪一下
 * 「请到电脑上打开」**（首帧当窄屏 → 渲染拦截页 → 水合完才换回应用）。
 * 反过来当宽屏，闪的那一帧落在手机上 —— 手机反正下一帧就要被拦住了，
 * 而电脑上一帧都不闪。这是 `手机暂时关闭-2026-09-19.md` §2 点名的那个坑。
 *
 * ⚠️ **不去改 `useIsWide` 本身**：它的 false 是片 a 故意选的方向
 * （窄屏"全都在"，首帧当窄屏 = 多出来的东西闪一下就没，而不是手机上悬浮球晚一帧才出现）。
 * 两个默认值服务的是两件相反的事，**但 media query 串仍然只有上面那一份**。
 */
export function useIsWideAssumeWide(): boolean {
  return useSyncExternalStore(subscribe, isWideNow, onServerWide);
}

"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// M3.12 片 a0 —— **凡是要贴住屏幕的浮层，一律裹这一层**。
//
// 为什么非有不可（2026-08-05 实测，不是推理）：
// `position: fixed` 只有在**祖先链上一个 transform / filter / backdrop-filter 都没有**时
// 才相对视口。我们每一页的 `<main class="page-enter">` 上都挂着一段升起动画，于是
// 那条链天生是脏的 —— 浮层改从 main 的左上角算起，而 main 是 `mx-auto max-w-2xl` 居中的。
//
// **比原先以为的严重**：`.page-enter` 原本写的是 `animation: … both`。`both` 会把
// 收尾那帧的 `transform: none` **定格成 identity 矩阵**（实测计算值是
// `matrix(1, 0, 0, 1, 0, 0)`，不是 `none`）—— identity 矩阵仍然算 transform，
// 所以那个 containing block **不是持续 280ms，是永远不释放**。
// 当天量到的实数（视口 1280×800，浮层写的是 `fixed inset-0`）：
//   实际矩形 [304, 56, 976, 800]，应为 [0, 0, 1280, 800] —— 左边差 304px、顶上差 56px。
// 手机 390 宽上左右正好（main 通栏），但**顶上照样差 56px**，所以流光边一直没真的
// 铺到屏幕顶，磨砂层也比视频底缘低 56px（那道缝就是这么来的）。
//
// `.page-enter` 已改成 `backwards`（动画结束后计算值回到 `none`，实测验过），
// 但动画进行中的那 280ms 里 transform 依然存在 —— 而 `?chat=1` 落地正好在那个窗口里
// 挂沉浸层。所以**光改 CSS 不够，浮层必须搬出 main**。
//
// ⚠️ 只用来裹 `position: fixed` 的东西。`document.body` 是 `flex flex-col`，
// 非 fixed 的子节点进去会变成 flex item，排版会走样。
//
// ⚠️ **在调用处裹，别在组件内部裹**。这一层要等挂载后才吐 portal（避开服务端渲染
// 和水合不一致），如果在组件内部裹，组件自己 mount 时那些 `ref.current` 还是空的，
// 量位置的 effect 会静默失效 —— 悬浮球就会永远停在左上角。裹在外面，
// 组件是在 portal 里才出生的，ref 一切正常。
// 「现在跑在浏览器里了吗」——服务端渲染和水合首帧一律 false（不吐 portal，
// 也就不会有水合不一致），水合完才翻 true。走 useSyncExternalStore 而不是
// useEffect 里 setState：同 source-list.tsx 的理由，那个写法多一轮级联渲染、lint 也拦。
// 三个函数必须定义在组件外，引用一变 React 会当成"外部源在变"而反复重渲。
const neverChanges = () => () => {};
const inBrowser = () => true;
const onServer = () => false;

export function ViewportLayer({ children }: { children: React.ReactNode }) {
  const ready = useSyncExternalStore(neverChanges, inBrowser, onServer);
  return ready ? createPortal(children, document.body) : null;
}

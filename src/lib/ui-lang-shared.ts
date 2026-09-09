// M3.9 片 c —— 界面语言 cookie 的名字与寿命，**客户端也要读得到的那一半**。
//
// 为什么从 `lib/ui-lang.ts` 里拆出来：那个文件顶上 `import { cookies } from "next/headers"`，
// 一旦被客户端组件 import 就是构建错误。而「中 / EN」那颗按钮（`lang-toggle.tsx`）
// 必须在浏览器里直接写这个 cookie —— 先写 cookie 再 `router.refresh()`，
// 服务端才拿得到新语言。所以常量归这里，读 header 的逻辑留在那边。
//
// D24：这份是纯常量，零依赖。

/** 语言镜像 cookie。**非 httpOnly** —— 客户端要写得动（切语言时不等一趟往返） */
export const UI_LANG_COOKIE = "fermata_ui";

/** 一年。语言不是会话级的东西 */
export const UI_LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * 在浏览器里把界面语言写进 cookie 镜像。
 *
 * **为什么不写在组件里**：`document.cookie = ...` 在组件体内会被
 * `react-hooks/immutability`（React Compiler 那套规则）判成"修改组件外部的变量"。
 * 规矩本身是对的 —— 副作用不该散在渲染路径上；挪进这个纯浏览器工具函数就干净了。
 *
 * ⚠️ 只在客户端调用。服务端要写这个 cookie 走 `/api/settings` 的 `Set-Cookie`。
 */
export function writeUiLangCookie(code: string): void {
  document.cookie = `${UI_LANG_COOKIE}=${code}; path=/; max-age=${UI_LANG_COOKIE_MAX_AGE}; samesite=lax`;
}

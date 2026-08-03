"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// M3.9 —— 设置页的返回箭头（创始人 2026-08-02：「每次更改后退出以后都立刻生效」）。
//
// 为什么不能是一个普通的 `<Link>`：语言偏好是**服务端渲染时读出来往下传的**，
// 而 Next 的客户端路由带缓存 —— 从设置页退回去，很可能拿的还是**进设置之前那份 HTML**，
// 于是"改了母语"要等他自己再刷新一次才看得出来。改完设置退出去还是老样子，
// 从用户那头看就等于**没改成功**（而且是静默的，D44 最恨的那种）。
//
// 所以这里退出去之前先 `router.refresh()` 把服务端数据作废掉，再导航。
// 顺带在这一小会儿里把箭头变成"正在生效…"，别让人以为点了没反应。
export function SettingsBack({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      aria-label={label}
      disabled={pending}
      onClick={() =>
        start(() => {
          // 顺序要紧：先作废缓存，再导航 —— 反过来的话导航先拿到的还是旧那份
          router.refresh();
          router.push(href);
        })
      }
      className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-500/60 text-base text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-60"
    >
      <span aria-hidden>{pending ? "…" : "←"}</span>
    </button>
  );
}

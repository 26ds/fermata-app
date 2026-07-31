"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * M3.6 底部导航（D37）—— 三个 tab，全站共用这一份。
 *
 * 为什么先做这个：原来它硬写在首页 `page.tsx` 里，**只有首页有**。
 * 再多两个页面各抄一份，高亮规则、间距、安全区必然走样 ——
 * 导航给的是"我在哪"的位置感，走样比丑更伤人。
 *
 * 挂在 `/`、`/watch`、`/library`、`/lab/live` 上，**不挂详情页**
 * （`/watch/[id]` 要给画面让位，D18；`/library/[id]` 用 ← 返回）。
 * 页面主体必须配 `.pb-nav` 留出高度，否则最后一屏被盖住。
 *
 * D42：所有文案集中在 TABS 里。M3.9 抽语言表时只动这一处，别把字散进 JSX 深处。
 */

const TABS = [
  // 首页 `/` 不属于任何一个 tab（它是门脸，不是分区），所以那儿三个都不高亮 —— 这是诚实的
  { href: "/watch", label: "观看", icon: "▷", prefix: "/watch" },
  { href: "/library", label: "历史与知识库", icon: "◫", prefix: "/library" },
  { href: "/lab/live", label: "Live 实验", icon: "◉", prefix: "/lab" },
];

export function BottomNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      className="glass fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-1 rounded-2xl px-2 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.28)]"
      aria-label="主要导航"
    >
      {TABS.map((t) => {
        const active = pathname === t.prefix || pathname.startsWith(`${t.prefix}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.7rem] transition-colors ${
              active
                ? "bg-ink-700 text-teal-300"
                : "text-ink-300 hover:bg-ink-700 hover:text-ink-100"
            }`}
          >
            <span className="text-base leading-none" aria-hidden>
              {t.icon}
            </span>
            {/* 「历史与知识库」六个字在小屏上最长 —— truncate 兜底，别把导航条撑变形 */}
            <span className="max-w-full truncate">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

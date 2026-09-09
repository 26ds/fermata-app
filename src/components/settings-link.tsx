import Link from "next/link";
import type { BackFrom } from "@/lib/nav";
import { getT } from "@/lib/ui-lang";

// M3.9 —— 右上角那个齿轮（创始人 2026-08-02：「设置应该占最底下的 tab，或者在右上角」）。
//
// 选右上角而不是加第四个 tab：底部三分是 D37 拍板的（观看 / 历史与知识库 / Live 实验），
// 动它得他再拍一次板；而齿轮在每个 tab 的同一个位置，**一眼就能找到、随时点得到**，
// 不用先想"设置属于哪个 tab"。真要换成底部第四个 tab 也随时改得动，说一声就行。
//
// 带 `?from=` 是 D43 的规矩：从哪儿进去的，返回箭头就退回哪儿。

// M3.9 片 c：改成 `async` server component 取文案 —— 它只是一个 `<Link>`，
// 为了一句 aria 文字把它变成客户端组件、往每个页面多塞一份 JS 是不划算的。
export async function SettingsLink({ from, sid }: { from: BackFrom; sid?: string }) {
  const t = await getT();
  const label = t("common.settings");

  return (
    <Link
      href={sid ? `/settings?from=${from}&sid=${sid}` : `/settings?from=${from}`}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-500/60 text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300"
    >
      <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" aria-hidden focusable="false">
        {/* ⚠️ 齿必须**咬住**中间那个环。第一版齿浮在外面、中心只有个小圆点，
            整个图标读起来是"太阳/亮度"而不是"设置"。齿的内端要压进环里 */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="10.85"
            y="1.9"
            width="2.3"
            height="5.2"
            rx="0.8"
            fill="currentColor"
            transform={`rotate(${deg} 12 12)`}
          />
        ))}
        <circle cx="12" cy="12" r="5.1" fill="none" stroke="currentColor" strokeWidth="2.2" />
        {/* 中心的孔。用 bg 的墨色填，让环里面是空的（这是齿轮和花朵的区别） */}
        <circle cx="12" cy="12" r="2.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </Link>
  );
}

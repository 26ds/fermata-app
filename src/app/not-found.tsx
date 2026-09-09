import Link from "next/link";
import { LangToggle } from "@/components/lang-toggle";
import { getT } from "@/lib/ui-lang";

// 找不到这一页时的落地处（M3.6-fix，创始人 2026-07-31「返回逻辑」那条的延伸）。
//
// 在这之前用的是 Next 自带的 404：一张白底英文页、**没有任何回去的入口** ——
// 删掉一条内容之后再点到它的旧链接，人就卡在那儿了，只能靠浏览器后退。
// 一个走不出去的页面是最糟的返回逻辑，所以这里至少给两个出口。
//
// M3.9 片 b 的注脚：根布局改 async 之后，**这一页是全站唯一真从预渲染变成按需渲染的**。
// 代价认了，换来的正是这个 —— 404 用读得懂的语言说话。
// D43 要求任何页面都有走得出去的路，而一条用看不懂的语言写的出路只算半条。
export default async function NotFound() {
  const t = await getT();

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      {/* 创始人 2026-09-09：语言开关每个界面都要有。这一页没有页头，
          所以它自己贴在右上角（安全区之内） */}
      <div className="absolute right-5 top-[max(1rem,env(safe-area-inset-top))] z-10">
        <LangToggle />
      </div>
      <main className="page-enter relative w-full max-w-sm text-center">
        <div className="teal-halo mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full border border-teal-600/60" aria-hidden>
          <span className="text-3xl text-teal-300">𝄐</span>
        </div>
        <p className="eyebrow mb-3 text-teal-300">not found</p>
        <h1 className="display-serif text-2xl text-ink-100">{t("nf.title")}</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-ink-300">{t("nf.lede")}</p>

        <div className="mt-8 grid gap-3">
          <Link
            href="/library"
            className="flex min-h-14 items-center justify-center rounded-2xl bg-teal-400 px-4 text-sm font-semibold text-teal-950 hover:bg-teal-300"
          >
            {t("nf.toLibrary")}
          </Link>
          <Link
            href="/"
            className="flex min-h-14 items-center justify-center rounded-2xl border border-ink-500/50 px-4 text-sm text-ink-100 hover:border-teal-400 hover:text-teal-300"
          >
            {t("nf.toHome")}
          </Link>
        </div>
      </main>
    </div>
  );
}

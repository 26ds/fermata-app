import Link from "next/link";

// 找不到这一页时的落地处（M3.6-fix，创始人 2026-07-31「返回逻辑」那条的延伸）。
//
// 在这之前用的是 Next 自带的 404：一张白底英文页、**没有任何回去的入口** ——
// 删掉一条内容之后再点到它的旧链接，人就卡在那儿了，只能靠浏览器后退。
// 一个走不出去的页面是最糟的返回逻辑，所以这里至少给两个出口。
//
// D42：文案集中在顶部常量里，M3.9 抽语言表时只动这一处。
const COPY = {
  eyebrow: "not found",
  title: "这一页找不到了。",
  lede: "多半是这条内容已经被删掉，或者链接不完整。你攒下的暂停点和词库都还在。",
  toHome: "回首页",
  toLibrary: "去历史与知识库",
};

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <main className="page-enter relative w-full max-w-sm text-center">
        <div className="teal-halo mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full border border-teal-600/60" aria-hidden>
          <span className="text-3xl text-teal-300">𝄐</span>
        </div>
        <p className="eyebrow mb-3 text-teal-300">{COPY.eyebrow}</p>
        <h1 className="display-serif text-2xl text-ink-100">{COPY.title}</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-ink-300">{COPY.lede}</p>

        <div className="mt-8 grid gap-3">
          <Link
            href="/library"
            className="flex min-h-14 items-center justify-center rounded-2xl bg-teal-400 px-4 text-sm font-semibold text-teal-950 hover:bg-teal-300"
          >
            {COPY.toLibrary}
          </Link>
          <Link
            href="/"
            className="flex min-h-14 items-center justify-center rounded-2xl border border-ink-500/50 px-4 text-sm text-ink-100 hover:border-teal-400 hover:text-teal-300"
          >
            {COPY.toHome}
          </Link>
        </div>
      </main>
    </div>
  );
}

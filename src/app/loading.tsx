// 首页骨架 —— 从观看 / 历史 / Live 返回时立刻有东西可看。
// M3.6：「知识原子」那张卡搬去 /library 了，这里跟着瘦下来，骨架得对得上真实页面。
export default function HomeLoading() {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70" />
      <header className="relative flex items-center justify-between px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>
            𝄐
          </span>
          <span className="text-sm font-semibold tracking-[0.12em]">FERMATA</span>
        </div>
      </header>

      <main className="pb-nav relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 sm:px-8" aria-busy="true">
        <section className="pt-7 sm:pt-12">
          <p className="eyebrow mb-4 text-teal-300">your learning archive</p>
          <div className="skeleton h-10 w-64 rounded-xl" />
          <div className="skeleton mt-4 h-4 w-full max-w-md rounded" />
        </section>
        <section className="mt-9 rounded-[1.75rem] border border-ink-500/50 bg-ink-700 p-5 sm:p-7">
          <div className="skeleton mx-auto mb-7 h-24 w-24 rounded-full" />
          <div className="grid grid-cols-2 gap-3">
            <div className="skeleton h-14 rounded-2xl" />
            <div className="skeleton h-14 rounded-2xl" />
          </div>
          <div className="skeleton mt-3 h-14 rounded-2xl" />
        </section>
      </main>
    </div>
  );
}

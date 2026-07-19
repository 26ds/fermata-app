// 知识库首页骨架 —— 从播放器/Live 返回时立刻有东西可看。
export default function LibraryLoading() {
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

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-28 sm:px-8" aria-busy="true">
        <section className="pt-7 sm:pt-12">
          <p className="eyebrow mb-4 text-teal-300">your learning archive</p>
          <div className="skeleton h-10 w-64 rounded-xl" />
          <div className="skeleton mt-4 h-4 w-full max-w-md rounded" />
        </section>
        <section className="mt-9 rounded-[1.75rem] border border-ink-500/50 bg-ink-700 p-5 sm:p-7">
          <div className="flex items-center justify-between border-b border-ink-500/30 pb-4">
            <div>
              <p className="text-sm font-semibold text-ink-100">知识原子</p>
              <p className="mt-1 text-xs text-ink-500">你主动留下的，才会留在这里</p>
            </div>
          </div>
          <div className="py-9 sm:py-12">
            <div className="skeleton mx-auto mb-7 h-24 w-24 rounded-full" />
            <div className="skeleton mx-auto h-6 w-56 rounded" />
            <div className="skeleton mx-auto mt-3 h-4 w-72 max-w-full rounded" />
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-ink-500/30 pt-4">
            <div className="skeleton h-14 rounded-2xl" />
            <div className="skeleton h-14 rounded-2xl" />
          </div>
        </section>
      </main>
    </div>
  );
}

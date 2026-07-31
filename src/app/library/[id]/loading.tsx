// 一条内容的回看页骨架。这一页没有播放器，所以骨架也别摆一个 16:9 的大块 ——
// 骨架跟真实页面对不上，数据到位时会跳一下。
export default function LibraryDetailLoading() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        <div className="h-9 w-9 shrink-0 rounded-full border border-ink-500/60" />
        <p className="eyebrow flex-1 text-teal-300">replay</p>
      </header>

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8" aria-busy="true">
        <div className="flex items-start gap-3 pt-2">
          <div className="skeleton h-[3.375rem] w-24 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton mt-2 h-3 w-24 rounded" />
            <div className="skeleton mt-3 h-3 w-28 rounded" />
          </div>
        </div>
        <div className="mt-6 border-b border-ink-500/30 pb-3">
          <div className="skeleton h-8 w-52 rounded-xl" />
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-ink-700">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-14 items-start gap-3 border-b border-ink-700/70 px-4 py-3 last:border-b-0">
              <div className="skeleton mt-1.5 h-2 w-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-4 w-2/3 rounded" />
                <div className="skeleton mt-2 h-3 w-full rounded" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

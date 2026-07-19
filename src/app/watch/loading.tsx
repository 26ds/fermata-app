// 跳转时立刻显示的骨架。有它，点链接是"马上换页"，没它是"卡一秒再换页"。
// 骨架的块要和真实页面对得上，否则数据到位时会跳一下。
export default function WatchLoading() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <header className="relative flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex min-h-11 items-center gap-2 text-sm text-ink-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-500/60 text-base" aria-hidden>←</span>
          <span>知识库</span>
        </div>
        <div className="text-right">
          <p className="eyebrow text-teal-300">watch</p>
          <p className="mt-1 text-xs text-ink-500">M1a · 播放器</p>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8" aria-busy="true">
        <div className="pt-4">
          <div className="skeleton h-9 w-44 rounded-xl" />
          <div className="skeleton mt-4 h-4 w-full max-w-md rounded" />
        </div>
        <div className="mt-7 rounded-[1.75rem] border border-ink-500/50 bg-ink-700 p-5 sm:p-6">
          <div className="skeleton h-4 w-32 rounded" />
          <div className="skeleton mt-3 h-14 w-full rounded-xl" />
          <div className="skeleton mt-3 h-14 w-full rounded-xl" />
        </div>
        <div className="mt-8">
          <div className="flex items-center justify-between border-b border-ink-500/30 pb-3">
            <p className="text-sm font-semibold text-ink-100">最近导入</p>
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-14 items-center gap-3 border-b border-ink-700/80 py-3">
              <div className="skeleton h-9 w-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-4 w-3/4 rounded" />
                <div className="skeleton mt-2 h-3 w-24 rounded" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

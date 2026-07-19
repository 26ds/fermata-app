// Live 实验页骨架 —— 这页要建音频通路，等待最久，骨架最有必要。
export default function LiveLoading() {
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <header className="relative flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex min-h-11 items-center gap-2 text-sm text-ink-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-500/60 text-base" aria-hidden>←</span>
          <span>知识库</span>
        </div>
        <div className="text-right">
          <p className="eyebrow text-teal-300">live / voice lab</p>
          <p className="mt-1 text-xs text-ink-500">M0.5</p>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-6 px-5" aria-busy="true">
        <div className="skeleton h-24 w-24 rounded-full" />
        <div className="skeleton h-4 w-40 rounded" />
      </main>
    </div>
  );
}

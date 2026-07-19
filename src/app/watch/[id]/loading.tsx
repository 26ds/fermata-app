// 观看页骨架：先把播放器那块 16:9 的位置占住，视频到位时不会把下面的内容顶下去。
export default function WatchDetailLoading() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      <header className="relative flex items-center justify-between gap-3 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-ink-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-500/60 text-base" aria-hidden>←</span>
          <span>播放器</span>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8" aria-busy="true">
        <div className="skeleton mb-4 h-5 w-2/3 rounded" />
        <div className="flex flex-col gap-4">
          <div className="skeleton aspect-video w-full rounded-2xl" />
          <div className="flex items-center justify-between rounded-2xl border border-ink-700 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-ink-500" aria-hidden />
              <span className="text-sm text-ink-500">正在准备播放器…</span>
            </div>
            <p className="ui-mono text-sm text-ink-500">--:-- / --:--</p>
          </div>
        </div>
      </main>
    </div>
  );
}

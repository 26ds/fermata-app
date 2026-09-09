import { getT } from "@/lib/ui-lang";

// 历史与知识库的骨架 —— 点底部 tab 是"马上换页"，不是"卡一秒再换页"。
// 骨架的块要和真实页面对得上（缩略图 + 两行文字），否则数据到位时会跳一下。
export default async function LibraryLoading() {
  const t = await getT();
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <header className="relative flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex min-h-11 items-center gap-2.5 text-sm text-ink-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>𝄐</span>
          <span className="text-sm font-semibold tracking-[0.12em]">FERMATA</span>
        </div>
        <div className="text-right">
          <p className="eyebrow text-teal-300">history / library</p>
          <p className="mt-1 text-xs text-ink-500">{t("library.name")}</p>
        </div>
      </header>

      <main className="pb-nav relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 sm:px-8" aria-busy="true">
        <div className="pt-4">
          <div className="skeleton h-9 w-56 rounded-xl" />
          <div className="skeleton mt-4 h-4 w-full max-w-md rounded" />
        </div>
        <div className="skeleton mt-6 h-16 w-full rounded-2xl" />
        <div className="mt-7 border-b border-ink-500/30 pb-3">
          <div className="skeleton h-8 w-40 rounded-xl" />
        </div>
        <div className="mt-4 flex flex-col gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-ink-700 px-3 py-3">
              <div className="skeleton h-[3.375rem] w-24 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-4 w-3/4 rounded" />
                <div className="skeleton mt-2 h-3 w-28 rounded" />
                <div className="skeleton mt-2 h-3 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

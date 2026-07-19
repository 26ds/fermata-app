import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { SignOutButton } from "@/components/sign-out-button";

// 知识库主页。M0 阶段：登录后看到空知识库（原子数为 0 的空态）。
export default async function LibraryPage() {
  if (!supabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("atoms")
    .select("*", { count: "exact", head: true });
  const atomCount = count ?? 0;

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70" />
      <header className="relative flex items-center justify-between px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Fermata 知识库">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>
            𝄐
          </span>
          <span className="text-sm font-semibold tracking-[0.12em]">FERMATA</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-40 truncate text-xs text-ink-500 sm:block">
            {user.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-28 sm:px-8">
        <section className="pt-7 sm:pt-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-4 text-teal-300">your learning archive</p>
              <h1 className="display-serif text-[2.3rem] leading-none tracking-[-0.05em] text-ink-100 sm:text-5xl">
                知识，慢慢长出来。
              </h1>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full border border-teal-600/60 text-2xl text-teal-300 sm:flex" aria-hidden>
              ↘
            </div>
          </div>
          <p className="mt-4 max-w-md text-sm leading-7 text-ink-300">
            这里收集你在视频和播客里真正停下来想过的瞬间。
          </p>
        </section>

        <section className="mt-9 rounded-[1.75rem] border border-ink-500/50 bg-ink-700 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] sm:p-7" aria-labelledby="library-title">
          <div className="flex items-center justify-between border-b border-ink-500/30 pb-4">
            <div>
              <p id="library-title" className="text-sm font-semibold text-ink-100">知识原子</p>
              <p className="mt-1 text-xs text-ink-500">你主动留下的，才会留在这里</p>
            </div>
            <span className="rounded-full border border-ink-500/50 px-2.5 py-1 text-xs tabular-nums text-ink-300">
              {String(atomCount).padStart(2, "0")} atoms
            </span>
          </div>

          {atomCount === 0 ? (
            <div className="py-9 sm:py-12">
              <div className="relative mx-auto mb-7 flex h-24 w-24 items-center justify-center rounded-full border border-teal-600/60 teal-halo" aria-hidden>
                <div className="absolute inset-2 rounded-full border border-dashed border-teal-800" />
                <span className="text-4xl text-teal-300">𝄐</span>
              </div>
              <div className="text-center">
                <h2 className="display-serif text-2xl text-ink-100">你的第一颗原子还在路上。</h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-300">
                  看完一段内容，打断、提问、复盘——那些让你眼睛亮起来的瞬间，会在这里变成可回看的知识。
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 py-10">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-950 text-xl text-teal-300" aria-hidden>✦</span>
              <div>
                <p className="text-sm font-medium text-ink-100">已经留下 {atomCount} 个知识原子</p>
                <p className="mt-1 text-sm text-ink-300">继续保持这份好奇，下一颗会更快找到你。</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-ink-500/30 pt-4">
            <Link href="/lab/live" className="group flex min-h-14 items-center justify-between rounded-2xl bg-teal-400 px-4 text-sm font-semibold text-teal-950 hover:bg-teal-300">
              <span>开始一次对话</span>
              <span className="text-lg transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
            </Link>
            <Link href="/watch" className="group flex min-h-14 items-center justify-between rounded-2xl border border-ink-500/50 px-4 text-sm text-ink-100 hover:border-teal-400 hover:text-teal-300">
              <span>播放器</span>
              <span className="text-lg transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
            </Link>
          </div>
        </section>

        <div className="mt-6 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl border border-ink-700/80 px-2 py-3"><p className="text-lg tabular-nums text-ink-100">{String(atomCount).padStart(2, "0")}</p><p className="mt-1 text-[0.65rem] uppercase tracking-wider text-ink-500">saved</p></div>
          <div className="rounded-2xl border border-ink-700/80 px-2 py-3"><p className="text-lg tabular-nums text-ink-100">00</p><p className="mt-1 text-[0.65rem] uppercase tracking-wider text-ink-500">sessions</p></div>
          <div className="rounded-2xl border border-ink-700/80 px-2 py-3"><p className="text-lg text-teal-300">∞</p><p className="mt-1 text-[0.65rem] uppercase tracking-wider text-ink-500">curiosity</p></div>
        </div>
      </main>

      <nav className="glass fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-md items-center justify-around rounded-2xl px-2 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.28)]" aria-label="主要导航">
        <Link href="/" className="flex min-h-11 min-w-24 flex-col items-center justify-center gap-0.5 rounded-xl bg-ink-700 text-xs text-teal-300" aria-current="page">
          <span className="text-base" aria-hidden>⌂</span><span>知识库</span>
        </Link>
        <Link href="/lab/live" className="flex min-h-11 min-w-24 flex-col items-center justify-center gap-0.5 rounded-xl text-xs text-ink-300 hover:bg-ink-700 hover:text-ink-100">
          <span className="text-base" aria-hidden>◉</span><span>Live 实验</span>
        </Link>
      </nav>
    </div>
  );
}

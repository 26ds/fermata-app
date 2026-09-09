import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/bottom-nav";
import { SetupNotice } from "@/components/setup-notice";
import { SignOutButton } from "@/components/sign-out-button";
import { LangToggle } from "@/components/lang-toggle";
import { getT } from "@/lib/ui-lang";

// 首页 = App 的门脸。
// M3.6（D37）：「知识原子」那张卡整块搬去了 `/library`（历史与知识库）——
// 攒下来的东西该和"看过什么"待在一起，而不是待在开屏页。
// 这里只留：你是谁、这是什么、去哪儿。底部三个 tab 由 <BottomNav /> 统一提供。
//
// M3.9 片 c：文案全走 `t()`。**只有 eyebrow 那几个小写英文标签留着不翻** ——
// 它们是版式元素（和 `settings` / `not found` 同族），不是给人读的句子。
export default async function HomePage() {
  if (!supabaseConfigured) return <SetupNotice />;
  const t = await getT();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70" />
      <header className="relative flex items-center justify-between px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label={t("common.home")}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>
            𝄐
          </span>
          <span className="text-sm font-semibold tracking-[0.12em]">FERMATA</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-40 truncate text-xs text-ink-500 sm:block">
            {user.email}
          </span>
          {/* 创始人 2026-09-09：语言开关每个界面都要有 */}
          <LangToggle />
          <SignOutButton />
        </div>
      </header>

      <main className="page-enter pb-nav relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 sm:px-8">
        <section className="pt-7 sm:pt-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-4 text-teal-300">your learning archive</p>
              <h1 className="display-serif text-[2.3rem] leading-none tracking-[-0.05em] text-ink-100 sm:text-5xl">
                {t("home.title")}
              </h1>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full border border-teal-600/60 text-2xl text-teal-300 sm:flex" aria-hidden>
              ↘
            </div>
          </div>
          <p className="mt-4 max-w-md text-sm leading-7 text-ink-300">{t("home.lede")}</p>
        </section>

        <section className="mt-9 rounded-[1.75rem] border border-ink-500/50 bg-ink-700 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] sm:p-7">
          <div className="relative mx-auto mb-7 flex h-24 w-24 items-center justify-center rounded-full border border-teal-600/60 teal-halo" aria-hidden>
            <div className="absolute inset-2 rounded-full border border-dashed border-teal-800" />
            <span className="text-4xl text-teal-300">𝄐</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Link href="/lab/live" className="group flex min-h-14 items-center justify-between rounded-2xl bg-teal-400 px-4 text-sm font-semibold text-teal-950 hover:bg-teal-300">
              <span>{t("home.toLive")}</span>
              <span className="text-lg transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
            </Link>
            <Link href="/watch" className="group flex min-h-14 items-center justify-between rounded-2xl border border-ink-500/50 px-4 text-sm text-ink-100 hover:border-teal-400 hover:text-teal-300">
              <span>{t("home.toWatch")}</span>
              <span className="text-lg transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
            </Link>
          </div>

          <Link
            href="/library"
            className="mt-3 flex min-h-14 items-center justify-center rounded-2xl border border-ink-500/30 px-4 text-sm text-ink-300 hover:border-teal-400 hover:text-teal-300"
          >
            {t("home.toLibrary")}
          </Link>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

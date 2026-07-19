import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { ImportForm } from "@/components/import-form";
import { SourceList, type SourceListItem } from "@/components/source-list";

// M1a — 播放器入口：贴链接导入 + 已导入内容列表。
export default async function WatchPage() {
  if (!supabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const BASE_COLUMNS = "id, kind, title, url, duration_s";
  const { data, error } = await supabase
    .from("sources")
    .select(`${BASE_COLUMNS}, last_position_s`)
    .order("created_at", { ascending: false })
    .limit(20);

  // 迁移 0002 还没跑时，last_position_s 这一列不存在，整个查询会失败 ——
  // 那样列表会变成空的，看着像内容全丢了。降级成只查老字段，进度先不显示。
  let sources = (data ?? []) as SourceListItem[];
  const needsMigration = Boolean(error);
  if (needsMigration) {
    const { data: fallback } = await supabase
      .from("sources")
      .select(BASE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(20);
    sources = ((fallback ?? []) as Omit<SourceListItem, "last_position_s">[]).map((s) => ({
      ...s,
      last_position_s: null,
    }));
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <header className="relative flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Link href="/" className="group flex min-h-11 items-center gap-2 text-sm text-ink-300 hover:text-ink-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-500/60 text-base transition-colors group-hover:border-teal-400 group-hover:text-teal-300" aria-hidden>←</span>
          <span>知识库</span>
        </Link>
        <div className="text-right">
          <p className="eyebrow text-teal-300">watch</p>
          <p className="mt-1 text-xs text-ink-500">M1a · 播放器</p>
        </div>
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <section className="pt-4">
          <h1 className="display-serif text-[2rem] leading-tight tracking-[-0.04em] text-ink-100">
            看点什么？
          </h1>
          <p className="mt-3 max-w-md text-sm leading-7 text-ink-300">
            贴一条链接就行。Fermata 只记住「你在第几秒停下来过」，不下载、不存视频。
          </p>
        </section>

        <section className="mt-7 rounded-[1.75rem] border border-ink-500/50 bg-ink-700 p-5 sm:p-6">
          <ImportForm />
        </section>

        <section className="mt-8" aria-labelledby="recent-title">
          <div className="flex items-center justify-between border-b border-ink-500/30 pb-3">
            <p id="recent-title" className="text-sm font-semibold text-ink-100">最近导入</p>
            <span className="rounded-full border border-ink-500/50 px-2.5 py-1 text-xs tabular-nums text-ink-300">
              {String(sources.length).padStart(2, "0")}
            </span>
          </div>

          {needsMigration && (
            <p className="mt-3 rounded-xl border border-ink-500/50 px-3 py-2 text-xs leading-5 text-ink-300">
              「看到第几秒」还没启用：去 Supabase → SQL Editor 跑一次
              <code className="text-ink-100"> supabase/migrations/0002_watch_progress.sql</code>
              。其余功能不受影响。
            </p>
          )}
          <SourceList items={sources} />
        </section>
      </main>
    </div>
  );
}

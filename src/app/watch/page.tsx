import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { ImportForm } from "@/components/import-form";
import type { SourceRow } from "@/lib/types";

function mmss(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// M1a — 播放器入口：贴链接导入 + 已导入内容列表。
export default async function WatchPage() {
  if (!supabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("sources")
    .select("id, kind, title, url, duration_s, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  const sources = (data ?? []) as Pick<
    SourceRow,
    "id" | "kind" | "title" | "url" | "duration_s" | "created_at"
  >[];

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

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
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

          {sources.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              还没有导入过内容。上面贴一条链接试试。
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {sources.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/watch/${s.id}`}
                    className="flex min-h-14 items-center gap-3 border-b border-ink-700/80 py-3 text-sm hover:text-teal-300"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-700 text-ink-300" aria-hidden>
                      ▷
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink-100">
                        {s.title ?? s.url ?? "未命名内容"}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-500">
                        {s.kind}
                        {s.duration_s ? ` · ${mmss(s.duration_s)}` : ""}
                      </span>
                    </span>
                    <span className="text-ink-500" aria-hidden>›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { WatchStage } from "@/components/watch-stage";
import type { SourceRow } from "@/lib/types";

// M1a — 观看页。RLS 保证只能查到自己的 source，查不到就是 404。
export default async function WatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;

  // Next 16：params 是 Promise，必须 await
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("sources")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const source = data as SourceRow;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      <header className="relative flex items-center justify-between gap-3 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Link href="/watch" className="group flex min-h-11 shrink-0 items-center gap-2 text-sm text-ink-300 hover:text-ink-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-500/60 text-base transition-colors group-hover:border-teal-400 group-hover:text-teal-300" aria-hidden>←</span>
          <span>播放器</span>
        </Link>
        <p className="min-w-0 truncate text-right text-xs text-ink-500">
          {source.transcript_status === "ready" ? "字幕就绪" : "字幕待生成"}
        </p>
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <h1 className="mb-4 text-base font-semibold leading-6 text-ink-100">
          {source.title ?? "未命名内容"}
        </h1>
        <WatchStage source={source} />
      </main>
    </div>
  );
}

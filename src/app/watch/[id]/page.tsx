import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { WatchStage } from "@/components/watch-stage";
import type { InterruptPoint } from "@/components/dot-bar";
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

  // 点点条首屏就该有历史点，所以顺手一起取（RLS 保证只查得到自己的）
  const { data: interruptRows } = await supabase
    .from("interrupts")
    .select("id, t_s, question_mode")
    .eq("source_id", id)
    .order("t_s", { ascending: true });
  const interrupts = (interruptRows ?? []) as InterruptPoint[];

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      {/* D18：页头压到最薄，标题并进这一行 —— 原本"返回 / 字幕状态"一行 + 标题一行
          白占掉约 44px 的纵向空间，而那正是视频画面想要的。字幕状态挪进了播放器
          下方的状态条（WatchStage 里），不再单占位置。 */}
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        <Link href="/watch" aria-label="返回播放器列表" className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-500/60 text-base text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300">
          <span aria-hidden>←</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-ink-100">
          {source.title ?? "未命名内容"}
        </h1>
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <WatchStage source={source} interrupts={interrupts} />
      </main>
    </div>
  );
}

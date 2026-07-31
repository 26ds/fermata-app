import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { WatchStage } from "@/components/watch-stage";
import type { PausePoint } from "@/components/pause-list";
import type { SourceRow } from "@/lib/types";
import { sourceOriginUrl } from "@/lib/source-origin";

// M1a — 观看页。RLS 保证只能查到自己的 source，查不到就是 404。
//
// M3.6 起这一页认两个查询参数（都从「历史与知识库」跳过来）：
//   ?t=<秒>   落地把播放头放到那一秒（那边没有播放器，只能真跳页）
//   ?chat=1   落地直接进沉浸聊天（沉浸层是这一页上的浮层，不是独立路由，见 D33）
export default async function WatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; chat?: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;

  // Next 16：params / searchParams 都是 Promise，必须 await
  const { id } = await params;
  const { t, chat } = await searchParams;
  // 认不出来的就当没传 —— 别拿 NaN 去 seek
  const parsedT = Number(t);
  const startAtS = Number.isFinite(parsedT) && parsedT > 0 ? parsedT : null;

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
  const origin = sourceOriginUrl(source);

  // 点点条首屏就该有历史点，所以顺手一起取（RLS 保证只查得到自己的）。
  // question / ai_answer 这一页其实用不上（回看列表已搬去 /library/[id]），
  // 但打断面板问完一轮后会就地更新这份 state，形状保持一致更省心。
  const { data: interruptRows } = await supabase
    .from("interrupts")
    .select("id, t_s, question_mode, question, ai_answer")
    .eq("source_id", id)
    .order("t_s", { ascending: true });
  const interrupts = (interruptRows ?? []) as PausePoint[];

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
        {/* 标题点一下回到原网页（YouTube 观看页 / 小宇宙单集页）。取不到就是纯文字。 */}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-ink-100">
          {origin ? (
            <a
              href={origin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在原网站打开：${source.title ?? "这条内容"}`}
              className="group inline-flex max-w-full items-center gap-1 hover:text-teal-300"
            >
              <span className="truncate">{source.title ?? "未命名内容"}</span>
              <span aria-hidden className="shrink-0 text-ink-400 transition-colors group-hover:text-teal-300">↗</span>
            </a>
          ) : (
            (source.title ?? "未命名内容")
          )}
        </h1>
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <WatchStage
          source={source}
          interrupts={interrupts}
          startAtS={startAtS}
          startInChat={chat === "1"}
        />
      </main>
    </div>
  );
}

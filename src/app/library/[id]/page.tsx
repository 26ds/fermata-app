import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { SettingsLink } from "@/components/settings-link";
import { LibraryDetail, type DatedPausePoint } from "@/components/library-detail";
import type { VocabItem } from "@/components/vocab-list";
import { thumbUrlFor } from "@/lib/thumb";
import { withFrom } from "@/lib/nav";
import { getLangPrefs } from "@/lib/settings";
import { hms } from "@/lib/time";
import type { SourceRow } from "@/lib/types";
import { captionScriptFor, conformSegments } from "@/lib/zh-script";

// M3.6 —— 一条内容的「回头看」页（D38）。**这里没有播放器**：
// 这一页是复盘用的，看视频请回 /watch/[id]。两个 tab：暂停点与聊天 / 词库。
//
// RLS 保证只能查到自己的 source，查不到就是 404。

// D42：文案集中在这里，M3.9 抽语言表时只动这一处
const COPY = {
  eyebrow: "replay",
  openInWatch: "在观看页打开 →",
  untitled: "未命名内容",
};

export default async function LibraryDetailPage({
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

  // `*` 而不是列清单：迁移 0007 跑没跑都不会炸，多的少的都能拿到
  const { data } = await supabase
    .from("sources")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const source = data as SourceRow & { thumb_url?: string | null; watch_count?: number | null };

  // 暂停点：比观看页多带 created_at —— 这一页要按"哪天看的那次"分堆
  const { data: interruptRows } = await supabase
    .from("interrupts")
    .select("id, t_s, question_mode, question, ai_answer, created_at")
    .eq("source_id", id)
    .order("t_s", { ascending: true });
  const points = (interruptRows ?? []) as DatedPausePoint[];

  // 「和这条内容聊过 N 轮」。迁移 0006 没跑时这张表不存在，查询会报错 ——
  // 当作没聊过就行，别让整页塌掉。个人数据，user_id 显式写死不跨用户（D33）。
  const { data: chatRow } = await supabase
    .from("chats")
    .select("messages")
    .eq("source_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const chatMessages = (chatRow as { messages?: unknown } | null)?.messages;
  const chatRounds = Array.isArray(chatMessages) ? Math.ceil(chatMessages.length / 2) : 0;

  // M3.7 tab2：本片词库。表在（0001）、`t_s` 也在（0007 已跑）；
  // 万一查不到就当空，别为一个 tab 把整页搞塌
  const { data: atomRows } = await supabase
    .from("atoms")
    .select("id, term, gloss, context_quote, t_s, source_id")
    .eq("source_id", id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const vocab = (atomRows ?? []) as VocabItem[];

  // D50：回看页的字幕也得跟观看页写成同一套字形 —— 两边不一致比两边都错还难受
  const prefs = await getLangPrefs(supabase, user.id);
  const transcript = source.transcript
    ? conformSegments(source.transcript, captionScriptFor(prefs))
    : source.transcript;

  const thumb = thumbUrlFor(source);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        <Link
          href="/library"
          aria-label="返回历史与知识库"
          className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-500/60 text-base text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300"
        >
          <span aria-hidden>←</span>
        </Link>
        <p className="eyebrow flex-1 text-teal-300">{COPY.eyebrow}</p>
        <SettingsLink from="libraryitem" sid={source.id} />
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <section className="flex items-start gap-3 pt-2">
          {/* 页头的缩略图跟列表里同一个来源（YouTube 拼、播客存），取不到就画占位块 */}
          <span className="relative block h-[3.375rem] w-24 shrink-0 overflow-hidden rounded-lg border border-ink-700 bg-ink-700">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- 见 history-list.tsx 的同款说明
              <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-lg text-ink-500" aria-hidden>
                {source.kind === "podcast" ? "◍" : "▷"}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 text-sm font-semibold leading-6 text-ink-100">
              {source.title ?? COPY.untitled}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
              <span>{source.kind}</span>
              {source.duration_s ? <span>{hms(source.duration_s)}</span> : null}
              {(source.watch_count ?? 0) > 1 ? (
                <span className="text-ink-300">看过 {source.watch_count} 次</span>
              ) : null}
            </p>
            {/* 带 from=library：在观看页按返回要退回这一页，不是退回内容列表 */}
            <Link
              href={withFrom(`/watch/${source.id}`, "library")}
              className="mt-2 inline-flex min-h-11 items-center text-xs text-teal-300 hover:text-teal-400"
            >
              {COPY.openInWatch}
            </Link>
          </div>
        </section>

        <LibraryDetail
          sourceId={source.id}
          points={points}
          transcript={transcript}
          chatRounds={chatRounds}
          vocab={vocab}
        />
      </main>
    </div>
  );
}

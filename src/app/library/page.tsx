import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/bottom-nav";
import { SettingsLink } from "@/components/settings-link";
import { LangToggle } from "@/components/lang-toggle";
import { getT } from "@/lib/ui-lang";
import { SetupNotice } from "@/components/setup-notice";
import { FoldersPlaceholder, HistoryList, type HistoryItem } from "@/components/history-list";

// M3.6 —— 「历史与知识库」（D37/D38）。底部第二个 tab。
//
// 这一页只回答一个问题：**我看过什么。**
// 导入了没看的不出现（那是「观看」tab 的事），置顶/收藏在这里也不参与排序 ——
// 两页各管各的组织方式，互相污染只会让人搞不清自己在看哪张表。

// D42：文案集中在这里，M3.9 抽语言表时只动这一处
// 迁移文件名不是文案，是一个要照抄进 SQL Editor 的字符串 —— 不进文案表
const MIGRATION_FILE = "0007_watch_history.sql";

// 迁移 0007 之前就有的列 —— 两条降级路径都带得上
const BASE_COLUMNS =
  "id, kind, title, url, external_id, duration_s, last_position_s, created_at";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;
  const t = await getT();

  // Next 16：searchParams 是 Promise，必须 await
  const { tab } = await searchParams;
  const showFolders = tab === "folders";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("atoms")
    .select("*", { count: "exact", head: true });
  const atomCount = count ?? 0;

  // 迁移 0007 没跑时那三列并不存在，整条查询会失败 —— 那样这一页会变成空的，
  // 看着像"我看过的东西全丢了"。所以从"全都要"开始降级，能拿多少是多少（照抄 /watch 的做法）。
  let rows: HistoryItem[] = [];
  let historyEnabled = true;

  const full = await supabase
    .from("sources")
    .select(`${BASE_COLUMNS}, last_watched_at, watch_count, thumb_url`)
    .order("last_watched_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(60);

  if (!full.error) {
    rows = ((full.data ?? []) as Omit<HistoryItem, "pause_count">[]).map((s) => ({
      ...s,
      pause_count: 0,
    }));
  } else {
    historyEnabled = false;
    const base = await supabase
      .from("sources")
      .select(BASE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(60);
    rows = ((base.data ?? []) as Omit<
      HistoryItem,
      "last_watched_at" | "watch_count" | "thumb_url" | "pause_count"
    >[]).map((s) => ({
      ...s,
      last_watched_at: null,
      watch_count: 0,
      thumb_url: null,
      pause_count: 0,
    }));
  }

  // 暂停点数：既用来在每行标「N 个暂停点」，也是"这条算不算看过"的第三条判据 ——
  // 迁移 0007 之前看过的内容没有 last_watched_at，但只要停过就说明确实看过。
  const { data: interruptRows } = await supabase
    .from("interrupts")
    .select("source_id")
    .limit(2000);
  const pauseCounts = new Map<string, number>();
  for (const r of (interruptRows ?? []) as { source_id: string | null }[]) {
    if (r.source_id) pauseCounts.set(r.source_id, (pauseCounts.get(r.source_id) ?? 0) + 1);
  }

  const visible = rows
    .map((s) => ({ ...s, pause_count: pauseCounts.get(s.id) ?? 0 }))
    .filter(
      (s) => s.last_watched_at || (s.last_position_s ?? 0) > 0 || s.pause_count > 0,
    );

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <header className="relative flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Link href="/" className="group flex min-h-11 items-center gap-2.5 text-sm text-ink-300 hover:text-ink-100" aria-label={t("common.home")}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>𝄐</span>
          <span className="text-sm font-semibold tracking-[0.12em]">FERMATA</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="eyebrow text-teal-300">history / library</p>
            <p className="mt-1 text-xs text-ink-500">{t("library.name")}</p>
          </div>
          {/* 创始人 2026-09-09：语言开关每个界面都要有 */}
          <LangToggle />
          <SettingsLink from="library" />
        </div>
      </header>

      <main className="page-enter pb-nav relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 sm:px-8">
        <section className="pt-4">
          <h1 className="display-serif text-[2rem] leading-tight tracking-[-0.04em] text-ink-100">
            {t("library.title")}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-7 text-ink-300">{t("library.lede")}</p>
        </section>

        {/* 从首页搬过来的「知识原子」（D37）。攒下来的东西该和"看过什么"待在一起。
            收成一条细带而不是整屏空态，免得把历史列表挤到屏外。
            M3.7：数字变成真的，并且**点得进去**了 —— 背词是跨视频的事（D40），
            所以全部词库单独一页，不塞在某条内容底下 */}
        <Link
          href="/library/vocab"
          className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-ink-500/50 bg-ink-700 px-4 py-3 transition-colors hover:border-teal-400/60"
          aria-label={t("library.atomsAria", atomCount)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink-100">{t("library.atomsTitle")}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-500">{t("library.atomsHint")}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-ink-500/50 px-2.5 py-1 text-xs tabular-nums text-ink-300">
              {String(atomCount).padStart(2, "0")} atoms
            </span>
            <span aria-hidden className="text-ink-500">
              →
            </span>
          </span>
        </Link>

        <section className="mt-7" aria-labelledby="history-tabs">
          <div className="flex items-center justify-between border-b border-ink-500/30 pb-3">
            <div className="flex items-center gap-1" id="history-tabs">
              <Link
                href="/library"
                aria-current={showFolders ? undefined : "page"}
                className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${
                  showFolders ? "text-ink-500 hover:text-ink-100" : "bg-ink-700 text-teal-300"
                }`}
              >
                {t("library.tabByDate")}
              </Link>
              <Link
                href="/library?tab=folders"
                aria-current={showFolders ? "page" : undefined}
                className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${
                  showFolders ? "bg-ink-700 text-teal-300" : "text-ink-500 hover:text-ink-100"
                }`}
              >
                {t("library.tabFolders")}
              </Link>
            </div>
            <span className="rounded-full border border-ink-500/50 px-2.5 py-1 text-xs tabular-nums text-ink-300">
              {String(visible.length).padStart(2, "0")}
            </span>
          </div>

          {!historyEnabled && (
            <p className="mt-3 rounded-xl border border-ink-500/50 px-3 py-2 text-xs leading-5 text-ink-300">
              {t("library.migrationNotice")}
              <code className="text-ink-100"> {MIGRATION_FILE}</code>
              {t("library.migrationTail")}
            </p>
          )}

          {showFolders ? (
            <FoldersPlaceholder />
          ) : (
            <HistoryList items={visible} historyEnabled={historyEnabled} />
          )}
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

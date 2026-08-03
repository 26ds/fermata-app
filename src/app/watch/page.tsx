import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/bottom-nav";
import { LangBootstrap } from "@/components/lang-bootstrap";
import { LangGuessBanner } from "@/components/lang-guess-banner";
import { SettingsLink } from "@/components/settings-link";
import { SetupNotice } from "@/components/setup-notice";
import { getLangPrefs } from "@/lib/settings";
import { ImportForm } from "@/components/import-form";
import { SourceList, type SourceListItem } from "@/components/source-list";

// created_at 是 M3.5 分组的依据 —— 放进 BASE_COLUMNS，三条降级路径就都带得上它
const BASE_COLUMNS = "id, kind, title, url, external_id, duration_s, created_at";

// M1a — 播放器入口：贴链接导入 + 已导入内容列表（全部 ｜ 收藏，见 D16）。
export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;

  // Next 16：searchParams 是 Promise，必须 await
  const { tab } = await searchParams;
  const onlyFavorites = tab === "favorites";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 迁移没跑时，那些列并不存在，整个查询会失败 —— 那样列表会变成空的，
  // 看着像内容全丢了。所以从"全都要"开始逐级降级，能拿多少是多少。
  let sources: SourceListItem[] = [];
  let progressEnabled = true;
  let flagsEnabled = true;

  const full = await supabase
    .from("sources")
    .select(`${BASE_COLUMNS}, last_position_s, pinned_at, favorited_at`)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);

  if (!full.error) {
    sources = (full.data ?? []) as SourceListItem[];
  } else {
    flagsEnabled = false;
    const withProgress = await supabase
      .from("sources")
      .select(`${BASE_COLUMNS}, last_position_s`)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!withProgress.error) {
      sources = ((withProgress.data ?? []) as Omit<
        SourceListItem,
        "pinned_at" | "favorited_at"
      >[]).map((s) => ({ ...s, pinned_at: null, favorited_at: null }));
    } else {
      progressEnabled = false;
      const base = await supabase
        .from("sources")
        .select(BASE_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(30);
      sources = ((base.data ?? []) as Omit<
        SourceListItem,
        "last_position_s" | "pinned_at" | "favorited_at"
      >[]).map((s) => ({
        ...s,
        last_position_s: null,
        pinned_at: null,
        favorited_at: null,
      }));
    }
  }

  const visible =
    onlyFavorites && flagsEnabled ? sources.filter((s) => s.favorited_at) : sources;
  const pendingMigrations = [
    progressEnabled ? null : "0002_watch_progress.sql",
    flagsEnabled ? null : "0003_source_flags.sql",
  ].filter(Boolean);

  // D42：母语探一次就够（`navigator.language`）。放在登录后最常落地的这一页，
  // 让它在真正需要语言判定（词库扫描）之前就已经有值。
  const prefs = await getLangPrefs(supabase, user.id);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <LangBootstrap prefs={prefs} />
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <header className="relative flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        {/* M3.6：/watch 从"首页的下一级"升成了底部第一个 tab（D37），
            所以这里不再是「← 返回知识库」，而是回门脸的 logo */}
        <Link href="/" className="group flex min-h-11 items-center gap-2.5 text-sm text-ink-300 hover:text-ink-100" aria-label="Fermata 首页">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>𝄐</span>
          <span className="text-sm font-semibold tracking-[0.12em]">FERMATA</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="eyebrow text-teal-300">watch</p>
            <p className="mt-1 text-xs text-ink-500">观看</p>
          </div>
          {/* 创始人 2026-08-02：设置得在一眼看得到的地方 */}
          <SettingsLink from="watch" />
        </div>
      </header>

      <main className="page-enter pb-nav relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 sm:px-8">
        {/* D42 修订① / D44：母语是自动填的就说一声。**只在他没确认过时出现**，
            确认过或点了 ✕ 就永远不再来（D18：别常驻挤压画面） */}
        <LangGuessBanner prefs={prefs} from="watch" />

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
            <div className="flex items-center gap-1" id="recent-title">
              <Link
                href="/watch"
                aria-current={onlyFavorites ? undefined : "page"}
                className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${
                  onlyFavorites ? "text-ink-500 hover:text-ink-100" : "bg-ink-700 text-teal-300"
                }`}
              >
                全部
              </Link>
              <Link
                href="/watch?tab=favorites"
                aria-current={onlyFavorites ? "page" : undefined}
                className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${
                  onlyFavorites ? "bg-ink-700 text-teal-300" : "text-ink-500 hover:text-ink-100"
                }`}
              >
                ★ 收藏
              </Link>
            </div>
            <span className="rounded-full border border-ink-500/50 px-2.5 py-1 text-xs tabular-nums text-ink-300">
              {String(visible.length).padStart(2, "0")}
            </span>
          </div>

          {pendingMigrations.length > 0 && (
            <p className="mt-3 rounded-xl border border-ink-500/50 px-3 py-2 text-xs leading-5 text-ink-300">
              有功能还没启用：去 Supabase → SQL Editor 跑一次
              {pendingMigrations.map((f) => (
                <code key={f} className="text-ink-100"> {f}</code>
              ))}
              。其余功能不受影响。
            </p>
          )}
          {/* 在「★ 收藏」那一栏点进去，返回时要退回收藏而不是"全部" */}
          <SourceList
            items={visible}
            flagsEnabled={flagsEnabled}
            from={onlyFavorites ? "favorites" : undefined}
          />
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

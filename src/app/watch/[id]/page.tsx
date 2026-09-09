import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { LangBootstrap } from "@/components/lang-bootstrap";
import { SetupNotice } from "@/components/setup-notice";
import { SettingsLink } from "@/components/settings-link";
import { LangToggle } from "@/components/lang-toggle";
import { getT } from "@/lib/ui-lang";
import { WatchStage } from "@/components/watch-stage";
import type { PausePoint } from "@/components/pause-list";
import type { SourceRow } from "@/lib/types";
import { getWatchPrefs } from "@/lib/settings";
import { sourceOriginUrl } from "@/lib/source-origin";
import { watchBackTarget } from "@/lib/nav";
import { conformSegments } from "@/lib/zh-convert";
import { captionScriptFor } from "@/lib/zh-script";

// M1a — 观看页。RLS 保证只能查到自己的 source，查不到就是 404。
//
// M3.6 起这一页认三个查询参数：
//   ?t=<秒>   落地把播放头放到那一秒（历史那边没有播放器，只能真跳页）
//   ?chat=1   落地直接进沉浸聊天（沉浸层是这一页上的浮层，不是独立路由，见 D33）
//   ?from=…   返回箭头退回哪一层（见 lib/nav.ts）—— 从历史点进来的要退回那条内容的回看页，
//             而不是一脚踹回内容列表
export default async function WatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; chat?: string; from?: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;

  // Next 16：params / searchParams 都是 Promise，必须 await
  const { id } = await params;
  const { t, chat, from } = await searchParams;
  // 认不出来的就当没传 —— 别拿 NaN 去 seek
  const parsedT = Number(t);
  const startAtS = Number.isFinite(parsedT) && parsedT > 0 ? parsedT : null;
  const back = watchBackTarget(from, id);

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
  const row = data as SourceRow;
  const origin = sourceOriginUrl(row);

  // 点点条首屏就该有历史点，所以顺手一起取（RLS 保证只查得到自己的）。
  // question / ai_answer 从 M3.15 片 b 起这一页**真的要用**：宽屏右栏那条问答线
  // 就是这批行（D62：每一轮问答就是一个捕获点），退出重进历史还在靠的正是它。
  //
  // ⚠️ `*` 而不是列清单，理由和回看页那句一样：**迁移 0011 跑没跑都不会炸**。
  // 列清单里写一个还不存在的列（`parent_id`），整页会当场 500 ——
  // 而这一页是产品的主界面，不该被一条还没跑的迁移拽下水。
  const { data: interruptRows } = await supabase
    .from("interrupts")
    .select("*")
    .eq("source_id", id)
    .order("t_s", { ascending: true });
  const interrupts = (interruptRows ?? []) as PausePoint[];

  // M3.7 / D42：三个语言（母语 / 目标语言 / 译文语言）。
  // 词库要标什么、AI 用哪门语言答、字幕译成什么，全从这里推 —— 不许硬编码。
  // 同一行 jsonb 里还存着倍速与「一跳几秒」，一次查齐（getWatchPrefs）。
  const { lang: prefs, play, autoScan } = await getWatchPrefs(supabase, user.id);

  // D50：字幕字形跟他的语言走，**在送到浏览器之前就转好**。
  // 转换在服务端做（词库 1MB，不该让每个用户下载一遍），所以客户端拿到的
  // 已经是最终字形 —— `watch-stage` 那边一行转换代码都没有。
  const source: SourceRow = row.transcript
    ? { ...row, transcript: conformSegments(row.transcript, captionScriptFor(prefs)) }
    : row;

  // M3.7：这条内容里已经收进词库的（首屏 ✓ 就该是实心的，不能等请求回来才补上）。
  // 表还没建 / 查失败一律当"一个都没收"，别让词库把观看页拖下水。
  const { data: atomRows } = await supabase
    .from("atoms")
    .select("id, term")
    .eq("source_id", id)
    .eq("user_id", user.id);
  const savedAtoms = (atomRows ?? []) as { id: string; term: string }[];
  // ⚠️ 这一页里翻译函数叫 `tr` 不叫 `t` —— `t` 已经被 `?t=`（深链要跳到第几秒）占了。
  // 全站其余地方仍是 `t`，只有这儿让一步
  const tr = await getT();

  return (
    // M3.12 片 a：宽屏下**整页不滚**（`lg:h-dvh`），滚的只有右栏 ——
    // 「视频不动、右边滚」就是桌面版的全部意义。
    // ⚠️ 不许改用 `position: sticky` 来实现：这个根节点是 `overflow-hidden`，
    // 它会成为 sticky 的滚动容器，于是 sticky 安安静静地什么都不做（D47⑩⒜）。
    <div className="relative flex min-h-dvh flex-col overflow-hidden lg:h-dvh">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      {/* D18：页头压到最薄，标题并进这一行 —— 原本"返回 / 字幕状态"一行 + 标题一行
          白占掉约 44px 的纵向空间，而那正是视频画面想要的。字幕状态挪进了播放器
          下方的状态条（WatchStage 里），不再单占位置。 */}
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        {/* 返回退一层，不是回首页 —— 从哪儿来退回哪儿去，规则在 lib/nav.ts */}
        <Link href={back.href} aria-label={tr(back.labelKey)} className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-500/60 text-base text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300">
          <span aria-hidden>←</span>
        </Link>
        {/* 标题点一下回到原网页（YouTube 观看页 / 小宇宙单集页）。取不到就是纯文字。 */}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-ink-100">
          {origin ? (
            <a
              href={origin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={tr("common.openOrigin", source.title ?? tr("common.untitled"))}
              className="group inline-flex max-w-full items-center gap-1 hover:text-teal-300"
            >
              <span className="truncate">{source.title ?? tr("common.untitled")}</span>
              <span aria-hidden className="shrink-0 text-ink-400 transition-colors group-hover:text-teal-300">↗</span>
            </a>
          ) : (
            (source.title ?? tr("common.untitled"))
          )}
        </h1>
        {/* 创始人 2026-09-09：语言开关每个界面都要有 */}
        <LangToggle />
        <SettingsLink from="player" sid={source.id} />
      </header>

      {/* 宽屏下松开那根 `max-w-2xl` 的居中柱子 —— **这一片真正要改的只有这里**。
          页头不用动：`<header>` 在 `<main>` 外面，本来就是通栏的（D47⑩⒝）。
          `lg:min-h-0` 是给下面的右栏留的：flex 子项不写它就不肯缩，`overflow-y-auto` 会失效。 */}
      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8 lg:max-w-none lg:min-h-0 lg:pb-4">
        <LangBootstrap prefs={prefs} />
        <WatchStage
          source={source}
          interrupts={interrupts}
          startAtS={startAtS}
          startInChat={chat === "1"}
          prefs={prefs}
          play={play}
          autoScan={autoScan}
          savedAtoms={savedAtoms}
        />
      </main>
    </div>
  );
}

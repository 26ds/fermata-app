import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { LangSettings } from "@/components/lang-settings";
import { SetupNotice } from "@/components/setup-notice";
import { VocabList, type VocabItem } from "@/components/vocab-list";
import { getLangPrefs } from "@/lib/settings";

// M3.7 —— 全部词库（D40）。**跨视频**：背词是跨视频的事，
// 所以除了每条内容底下那份（`/library/[id]` tab2），这里再给一份合起来的。
//
// 点一条 = 回观看页跳到它出现的那一秒（`from=vocab`，返回箭头退回这一页，D43）。

// D42：文案集中在这里，M3.9 抽语言表时只动这一处
const COPY = {
  eyebrow: "vocabulary",
  title: "你收下的词与概念。",
  lede: "每一条都记得它出现在哪、那句话原本怎么说 —— 点一下就回到那一秒。",
  back: "返回历史与知识库",
  count: (n: number) => `${n} 条`,
};

export default async function VocabPage() {
  if (!supabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: atomRows } = await supabase
    .from("atoms")
    .select("id, term, gloss, context_quote, t_s, source_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  const atoms = (atomRows ?? []) as VocabItem[];

  // 出处标题另查一次而不是走内联 join —— join 一旦因为外键/权限出岔子，
  // 整张词库就空了；分开查最差也只是少个标题
  const sourceIds = [...new Set(atoms.map((a) => a.source_id).filter(Boolean))] as string[];
  const titles = new Map<string, string | null>();
  if (sourceIds.length > 0) {
    const { data: srcRows } = await supabase
      .from("sources")
      .select("id, title")
      .in("id", sourceIds);
    for (const s of (srcRows ?? []) as { id: string; title: string | null }[]) {
      titles.set(s.id, s.title);
    }
  }
  const items: VocabItem[] = atoms.map((a) => ({
    ...a,
    source_title: a.source_id ? (titles.get(a.source_id) ?? null) : null,
  }));

  const prefs = await getLangPrefs(supabase, user.id);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        {/* D43：新页面照样得有走得出去的路 */}
        <Link
          href="/library"
          aria-label={COPY.back}
          className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-500/60 text-base text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300"
        >
          <span aria-hidden>←</span>
        </Link>
        <p className="eyebrow flex-1 text-teal-300">{COPY.eyebrow}</p>
        <span className="shrink-0 rounded-full border border-ink-500/50 px-2.5 py-1 text-xs tabular-nums text-ink-300">
          {COPY.count(items.length)}
        </span>
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <section className="pt-2">
          <h1 className="display-serif text-2xl leading-tight tracking-[-0.03em] text-ink-100">
            {COPY.title}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-ink-300">{COPY.lede}</p>
        </section>

        {/* D42：目标语言是靠一句问询定的，这里是唯一能改回来的地方（见组件里的说明） */}
        <div className="mt-5">
          <LangSettings prefs={prefs} />
        </div>

        <VocabList items={items} from="vocab" showSource emptyAll />
      </main>
    </div>
  );
}

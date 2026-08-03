import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { LangSettings } from "@/components/lang-settings";
import { SettingsBack } from "@/components/settings-back";
import { SetupNotice } from "@/components/setup-notice";
import { getLangPrefs } from "@/lib/settings";
import { settingsBackTarget } from "@/lib/nav";

// M3.9 片 a —— 设置。
//
// 在此之前 Fermata **根本没有一个叫"设置"的地方**：语言那两个选择器被临时
// 塞在 `/library/vocab` 顶上（M3.7 的权宜之计），谁也想不到去词库页改母语。
// 母语被自动猜错这件事之所以能一路瞒到 2026-08-01 才被发现，这是原因之一。
//
// 现在只有「语言」一块。别急着往里堆东西 —— 设置页最容易长成一个杂物间。

// D42：文案集中在这里，片 d 换 t() 时只动这一处
const COPY = {
  eyebrow: "settings",
  title: "设置",
  lede: "母语，和你看这些东西是为了什么。改完立刻生效，不用重新登录。",
};

export default async function SettingsPage({
  searchParams,
}: {
  // Next 16：searchParams 是 Promise，必须 await
  searchParams: Promise<{ from?: string; sid?: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;

  const { from, sid } = await searchParams;
  const back = settingsBackTarget(from, sid);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prefs = await getLangPrefs(supabase, user.id);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        {/* D43：进来的是哪条路，退回去就是哪条路。
            退出去之前会先把服务端数据作废（见组件）—— 否则改完设置退回去还是老样子 */}
        <SettingsBack href={back.href} label={back.label} />
        <p className="eyebrow flex-1 text-teal-300">{COPY.eyebrow}</p>
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <section className="pt-2">
          <h1 className="display-serif text-2xl leading-tight tracking-[-0.03em] text-ink-100">
            {COPY.title}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-ink-300">{COPY.lede}</p>
        </section>

        <div className="mt-5">
          <LangSettings prefs={prefs} />
        </div>
      </main>
    </div>
  );
}

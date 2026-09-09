import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { AccountSettings } from "@/components/account-settings";
import { LangSettings } from "@/components/lang-settings";
import { SettingsBack } from "@/components/settings-back";
import { SetupNotice } from "@/components/setup-notice";
import { getLangPrefs } from "@/lib/settings";
import { settingsBackTarget } from "@/lib/nav";
import { enabledProviders } from "@/lib/supabase/providers";
import { LangToggle } from "@/components/lang-toggle";
import { getT } from "@/lib/ui-lang";

// M3.9 片 a —— 设置。
//
// 在此之前 Fermata **根本没有一个叫"设置"的地方**：语言那两个选择器被临时
// 塞在 `/library/vocab` 顶上（M3.7 的权宜之计），谁也想不到去词库页改母语。
// 母语被自动猜错这件事之所以能一路瞒到 2026-08-01 才被发现，这是原因之一。
//
// 两块：「语言」和「账号」（账号是 2026-09-09 加的，创始人要「切换账号 / Google 登录」）。
// 别急着往里堆第三块 —— 设置页最容易长成一个杂物间。

export default async function SettingsPage({
  searchParams,
}: {
  // Next 16：searchParams 是 Promise，必须 await
  searchParams: Promise<{ from?: string; sid?: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;

  const { from, sid } = await searchParams;
  const back = settingsBackTarget(from, sid);
  const t = await getT();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prefs = await getLangPrefs(supabase, user.id);
  // 后台开了 Google 才渲染那颗按钮（现查 GoTrue，不靠环境变量、不用重新部署）——
  // 和登录页同一个判据，**两处必须一致**：登录页有、设置页没有会让人以为坏了
  const { google } = await enabledProviders();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
      <header className="relative flex items-center gap-3 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        {/* D43：进来的是哪条路，退回去就是哪条路。
            退出去之前会先把服务端数据作废（见组件）—— 否则改完设置退回去还是老样子 */}
        <SettingsBack href={back.href} label={t(back.labelKey)} />
        <p className="eyebrow flex-1 text-teal-300">settings</p>
        {/* 创始人 2026-09-09：语言开关每个界面都要有 —— 设置页尤其该有，
            这儿正是"改语言"这件事的主场 */}
        <LangToggle />
      </header>

      <main className="page-enter relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <section className="pt-2">
          <h1 className="display-serif text-2xl leading-tight tracking-[-0.03em] text-ink-100">
            {t("settings.title")}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-ink-300">{t("settings.lede")}</p>
        </section>

        <div className="mt-5 flex flex-col gap-4">
          <LangSettings prefs={prefs} />
          {/* 创始人 2026-09-09：「在右上角设置里面添加切换账号 / Google 登录功能」。
              排在语言下面，因为上面那句 lede 说的是语言 —— 页面的第一段话
              和第一块内容要对得上 */}
          <AccountSettings email={user.email ?? ""} showGoogle={google} />
        </div>
      </main>
    </div>
  );
}

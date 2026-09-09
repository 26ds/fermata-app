import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { enabledProviders } from "@/lib/supabase/providers";
import { LoginForm } from "@/components/login-form";
import { SetupNotice } from "@/components/setup-notice";
import { LangToggle } from "@/components/lang-toggle";
import { getT } from "@/lib/ui-lang";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!supabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { error } = await searchParams;
  const t = await getT();
  // 后台开了 Google 才渲染那颗按钮（现查 GoTrue，不靠环境变量、不用重新部署）
  const { google } = await enabledProviders();

  return (
    <main className="relative flex min-h-dvh flex-1 flex-col overflow-hidden px-5 py-6 sm:px-8">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-3/5 opacity-80" />
      <header className="relative flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-[0.12em] text-ink-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>
            𝄐
          </span>
          FERMATA
        </p>
        {/* 创始人 2026-09-09：语言开关每个界面都要有。
            **这一屏尤其要紧** —— 它是外国人看到的第一页，
            而这时候还没有账号、没有 uiLang，语言全靠 cookie 那一层撑着 */}
        <div className="flex items-center gap-3">
          <span className="eyebrow hidden sm:inline">private learning space</span>
          <LangToggle />
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <div className="mb-8">
          <p className="eyebrow mb-4 text-teal-300">/ pause · notice · remember</p>
          <h1 className="display-serif max-w-xs text-[2.45rem] leading-[1.06] tracking-[-0.04em] text-ink-100">
            {t("login.headline1")}
            <br />
            {t("login.headline2")}
          </h1>
          <p className="mt-4 max-w-xs text-sm leading-7 text-ink-300">{t("login.lede")}</p>
        </div>

        <section className="rounded-[1.75rem] border border-ink-500/40 bg-ink-700 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]" aria-label={t("login.aria")}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink-100">{t("login.cardTitle")}</p>
              <p className="mt-1 text-xs text-ink-500">
                {google ? t("login.cardHintGoogle") : t("login.cardHintEmail")}
              </p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-teal-600/60 text-sm text-teal-300" aria-hidden>
              ↗
            </span>
          </div>
        <LoginForm
          showGoogle={google}
          initialError={
            error === "auth" ? t("login.errAuth") : undefined
          }
        />
        </section>
      </div>

      {/* 隐私政策/条款必须从登录页点得到 —— Google 同意屏幕挂的就是这两个链接，
          而且注册前就该看得见，不能藏在登录之后 */}
      <footer className="relative flex flex-col gap-3 pb-[env(safe-area-inset-bottom)] text-xs text-ink-500">
        <div className="flex items-center justify-between">
          <span>Fermata / 01</span>
          <span>{t("login.tagline")}</span>
        </div>
        {/* 单独一行，不挤掉那句标语 */}
        <div className="flex items-center gap-4 border-t border-ink-500/25 pt-3">
          <Link href="/privacy" className="min-h-8 underline-offset-4 hover:text-ink-100 hover:underline">
            {t("login.privacy")}
          </Link>
          <Link href="/terms" className="min-h-8 underline-offset-4 hover:text-ink-100 hover:underline">
            {t("login.terms")}
          </Link>
        </div>
      </footer>
    </main>
  );
}

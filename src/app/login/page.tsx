import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { enabledProviders } from "@/lib/supabase/providers";
import { LoginForm } from "@/components/login-form";
import { SetupNotice } from "@/components/setup-notice";

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
        <span className="eyebrow">private learning space</span>
      </header>

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <div className="mb-8">
          <p className="eyebrow mb-4 text-teal-300">/ pause · notice · remember</p>
          <h1 className="display-serif max-w-xs text-[2.45rem] leading-[1.06] tracking-[-0.04em] text-ink-100">
            让每一次停留，<br />都留下点什么。
          </h1>
          <p className="mt-4 max-w-xs text-sm leading-7 text-ink-300">
            看视频、听播客的时候，Fermata 帮你把好奇心变成记得住的东西。
          </p>
        </div>

        <section className="rounded-[1.75rem] border border-ink-500/40 bg-ink-700 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]" aria-label="登录">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink-100">进入你的学习舱</p>
              <p className="mt-1 text-xs text-ink-500">
                {google ? "无密码 · Google 或邮箱都行" : "无密码 · 只用邮箱确认身份"}
              </p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-teal-600/60 text-sm text-teal-300" aria-hidden>
              ↗
            </span>
          </div>
        <LoginForm
          showGoogle={google}
          initialError={
            error === "auth" ? "登录链接无效或已过期，请重新发送一封。" : undefined
          }
        />
        </section>
      </div>

      {/* 隐私政策/条款必须从登录页点得到 —— Google 同意屏幕挂的就是这两个链接，
          而且注册前就该看得见，不能藏在登录之后 */}
      <footer className="relative flex flex-col gap-3 pb-[env(safe-area-inset-bottom)] text-xs text-ink-500">
        <div className="flex items-center justify-between">
          <span>Fermata / 01</span>
          <span>停留之处，即学习之处。</span>
        </div>
        {/* 单独一行，不挤掉那句标语 */}
        <div className="flex items-center gap-4 border-t border-ink-500/25 pt-3">
          <Link href="/privacy" className="min-h-8 underline-offset-4 hover:text-ink-100 hover:underline">
            隐私政策
          </Link>
          <Link href="/terms" className="min-h-8 underline-offset-4 hover:text-ink-100 hover:underline">
            服务条款
          </Link>
        </div>
      </footer>
    </main>
  );
}

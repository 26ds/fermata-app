import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/bottom-nav";
import { SettingsLink } from "@/components/settings-link";
import { SetupNotice } from "@/components/setup-notice";
import { LiveConsole } from "@/components/live-console";

// M0.5 实验页：/lab/live — Gemini Live 语音通路 spike。
// 只做通路验证，不承载教学逻辑（教学法唯一来源是 SKILL.md，M4 才接入）。
export default async function LiveLabPage() {
  if (!supabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <header className="relative flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        {/* M3.6：/lab/live 升成底部第三个 tab（D37），返回箭头换成回门脸的 logo */}
        <Link href="/" className="group flex min-h-11 items-center gap-2.5 text-sm text-ink-300 hover:text-ink-100" aria-label="Fermata 首页">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950" aria-hidden>𝄐</span>
          <span className="text-sm font-semibold tracking-[0.12em]">FERMATA</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="eyebrow text-teal-300">live / voice lab</p>
            <p className="mt-1 text-xs text-ink-500">M0.5 · {user.email?.split("@")[0]}</p>
          </div>
          <SettingsLink from="live" />
        </div>
      </header>
      <LiveConsole geminiConfigured={Boolean(process.env.GEMINI_API_KEY)} />
      <BottomNav />
    </div>
  );
}

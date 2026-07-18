import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
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
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link href="/" className="text-sm text-ink-500 hover:text-ink-300">
          ← 知识库
        </Link>
        <p className="text-sm font-medium text-ink-300">
          Live 实验室 <span className="text-ink-500">· M0.5</span>
        </p>
      </header>
      <LiveConsole geminiConfigured={Boolean(process.env.GEMINI_API_KEY)} />
    </div>
  );
}

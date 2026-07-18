import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { SignOutButton } from "@/components/sign-out-button";

// 知识库主页。M0 阶段：登录后看到空知识库（原子数为 0 的空态）。
export default async function LibraryPage() {
  if (!supabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("atoms")
    .select("*", { count: "exact", head: true });
  const atomCount = count ?? 0;

  return (
    <>
      <header className="flex items-center justify-between px-5 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-lg font-semibold tracking-wide">
          <span className="mr-1.5 text-teal-400" aria-hidden>
            𝄐
          </span>
          Fermata
        </p>
        <div className="flex items-center gap-3">
          <span className="max-w-40 truncate text-xs text-ink-500">
            {user.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
        {atomCount === 0 ? (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-teal-800 text-4xl text-teal-400">
              𝄐
            </div>
            <h1 className="font-(family-name:--font-quote) text-2xl text-ink-100">
              知识库还空着。
            </h1>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-ink-300">
              看完第一支视频或第一集播客后，你打断、提问、复盘出的知识原子会沉淀在这里。
            </p>
            <p className="mt-8 inline-block rounded-full border border-ink-700 px-4 py-1.5 text-xs text-ink-500">
              播放器将在 M1 上线
            </p>
            <p className="mt-4">
              <Link
                href="/lab/live"
                className="inline-block rounded-full border border-teal-800 px-4 py-1.5 text-xs text-teal-300 transition-colors hover:bg-teal-950/40"
              >
                M0.5 实验：和 Gemini 语音对话 →
              </Link>
            </p>
          </div>
        ) : (
          <p className="text-ink-300">共 {atomCount} 个知识原子</p>
        )}
      </main>

      <footer className="pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-ink-500">
        Fermata v0.1 · M0 骨架
      </footer>
    </>
  );
}

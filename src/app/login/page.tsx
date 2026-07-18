import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
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

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="mb-2 text-center text-5xl text-teal-400" aria-hidden>
          𝄐
        </p>
        <h1 className="text-center text-2xl font-semibold tracking-wide">
          Fermata
        </h1>
        <p className="mt-2 mb-10 text-center font-(family-name:--font-quote) text-ink-300">
          停留之处，即学习之处。
        </p>
        <LoginForm
          initialError={
            error === "auth" ? "登录链接无效或已过期，请重新发送一封。" : undefined
          }
        />
      </div>
    </main>
  );
}

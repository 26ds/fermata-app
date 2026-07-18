"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  async function onClick() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
    >
      退出
    </button>
  );
}

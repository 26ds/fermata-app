"use client";

import { createClient } from "@/lib/supabase/client";
import { useCopy } from "@/components/copy-provider";

export function SignOutButton() {
  const t = useCopy();

  async function onClick() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <button
      onClick={onClick}
      className="min-h-10 rounded-xl border border-ink-500/50 px-3 text-xs font-medium text-ink-300 hover:border-ink-300 hover:text-ink-100"
    >
      {t("common.signOut")}
    </button>
  );
}

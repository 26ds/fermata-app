"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(initialError ? "error" : "idle");
  const [message, setMessage] = useState(initialError ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-teal-800 bg-ink-700/50 p-6 text-center">
        <p className="text-teal-300">登录链接已发送至</p>
        <p className="mt-1 font-medium break-all">{email}</p>
        <p className="mt-4 text-sm text-ink-300">
          去邮箱点开那封邮件即可登录。没收到的话，检查垃圾邮件文件夹。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm text-ink-300">
        邮箱登录，无需密码
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-xl border border-ink-700 bg-ink-700/40 px-4 py-3 text-ink-100 placeholder:text-ink-500 outline-none focus:border-teal-600"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-xl bg-teal-400 px-4 py-3 font-semibold text-teal-950 transition-opacity disabled:opacity-60"
      >
        {status === "sending" ? "发送中…" : "发送登录链接"}
      </button>
      {status === "error" && (
        <p className="text-sm text-red-400" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}

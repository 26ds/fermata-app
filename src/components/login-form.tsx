"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "verifying";

/** 把 Supabase/SMTP 的原始报错翻译成人话 */
function friendlyError(raw: string): string {
  const msg = raw || "";
  if (msg.includes("For security purposes")) {
    const s = msg.match(/(\d+) seconds/)?.[1];
    return `发送太频繁：安全限制要求两次发送之间间隔 60 秒${s ? `（还需等约 ${s} 秒）` : ""}。`;
  }
  if (/rate limit/i.test(msg)) {
    return "邮件发送额度暂时用完了，请稍后再试。";
  }
  if (/expired|invalid/i.test(msg)) {
    return "验证码不对或已过期，重新发送一封再试。";
  }
  if (/error sending|recipient/i.test(msg) || msg.trim() === "{}" || msg.trim() === "") {
    return "邮件服务拒绝发送。注意：Resend 测试发件人只能发给你注册 Resend 用的那个邮箱，别的收件地址都会被拒收。";
  }
  return msg;
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState(initialError ?? "");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("idle");
      setError(friendlyError(error.message));
    } else {
      setStatus("sent");
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("verifying");
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setStatus("sent");
      setError(friendlyError(error.message));
    } else {
      window.location.href = "/";
    }
  }

  if (status === "sent" || status === "verifying") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-teal-600/60 bg-teal-950 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-400 text-sm font-bold text-teal-950" aria-hidden>
              ✓
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-teal-100">确认邮件已出发</p>
              <p className="mt-1 break-all text-sm text-teal-300">{email}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-teal-300">
            在<span className="text-ink-100">这台设备</span>上点邮件里的登录按钮；
            如果邮件是在<span className="text-ink-100">别的设备</span>上打开的，
            把邮件里的数字验证码填到下面。
          </p>
        </div>
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            required
            placeholder="邮件里的验证码"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-14 rounded-xl border border-ink-500/70 bg-ink-900 px-4 text-center text-lg tracking-[0.4em] text-ink-100 placeholder:tracking-normal placeholder:text-ink-500 outline-none focus:border-teal-400"
          />
          <button
            type="submit"
            disabled={status === "verifying" || code.trim().length < 6}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 font-semibold text-teal-950 disabled:opacity-50"
          >
            {status === "verifying" ? "确认中…" : "用验证码登录"}
            {status !== "verifying" && <span aria-hidden>→</span>}
          </button>
        </form>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setCode("");
            setError("");
          }}
          className="min-h-11 text-sm text-ink-500 underline-offset-4 hover:text-ink-100 hover:underline"
        >
          换个邮箱 / 重新发送
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-xs font-semibold tracking-wide text-ink-300">
        你的邮箱
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-14 rounded-xl border border-ink-500/70 bg-ink-900 px-4 text-ink-100 placeholder:text-ink-500 outline-none focus:border-teal-400"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-1 flex h-14 items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 font-semibold text-teal-950 disabled:opacity-50"
      >
        {status === "sending" ? "正在发送…" : "发送登录邮件"}
        {status !== "sending" && <span aria-hidden>→</span>}
      </button>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

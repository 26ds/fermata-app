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
        <div className="rounded-2xl border border-teal-800 bg-ink-700/50 p-5 text-center">
          <p className="text-teal-300">邮件已发送至</p>
          <p className="mt-1 font-medium break-all">{email}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-300">
            在<span className="text-ink-100">这台设备</span>上点邮件里的登录按钮；
            如果邮件是在<span className="text-ink-100">别的设备</span>上打开的，
            把邮件里的 6 位验证码填到下面。
          </p>
        </div>
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            placeholder="6 位验证码"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-xl border border-ink-700 bg-ink-700/40 px-4 py-3 text-center text-lg tracking-[0.4em] text-ink-100 placeholder:tracking-normal placeholder:text-ink-500 outline-none focus:border-teal-600"
          />
          <button
            type="submit"
            disabled={status === "verifying" || code.trim().length < 6}
            className="rounded-xl bg-teal-400 px-4 py-3 font-semibold text-teal-950 transition-opacity disabled:opacity-60"
          >
            {status === "verifying" ? "验证中…" : "用验证码登录"}
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
          className="text-sm text-ink-500 underline-offset-4 hover:text-ink-300 hover:underline"
        >
          换个邮箱 / 重新发送
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="flex flex-col gap-3">
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
        {status === "sending" ? "发送中…" : "发送登录邮件"}
      </button>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

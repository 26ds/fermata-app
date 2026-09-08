"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "verifying" | "google";

/**
 * 把 Supabase/SMTP 的原始报错翻译成人话。**D44：说得出是哪一种失败** ——
 * 这几条分支各对应一个真实起因，顺序不能乱（先认具体的，最后才落到笼统的）。
 *
 * ⚠️ 这里**不许写发信服务商的名字或配置**：这段字是给注册的人看的，
 * 而发信怎么配是后台的事（换一次服务商这句话就成了假话，2026-09-08 已经发生过一次）。
 */
function friendlyError(raw: string): string {
  const msg = raw || "";
  if (msg.includes("For security purposes")) {
    const s = msg.match(/(\d+) seconds/)?.[1];
    return `发送太频繁：安全限制要求两次发送之间间隔 60 秒${s ? `（还需等约 ${s} 秒）` : ""}。`;
  }
  if (/rate limit/i.test(msg)) {
    return "这一小时的邮件发送额度用完了，过一会儿再试。";
  }
  // Google 那颗按钮平时只在后台开着时才渲染；万一在「打开页面」和「点下去」之间被关掉，
  // 走到这里。**必须排在下面那条 not enabled 前面**，否则会被误报成"注册关闭了"
  if (/unsupported provider|provider is not enabled/i.test(msg)) {
    return "Google 登录暂时不可用，请用下面的邮箱登录。";
  }
  // 后台关掉了「允许新用户注册」时，老用户照发、新邮箱走到这里
  if (/signups? not allowed|not enabled/i.test(msg)) {
    return "这个邮箱还没法注册：新用户注册暂时是关着的。";
  }
  // 邮箱本身写错（"Unable to validate email address: invalid format"）——
  // 必须排在下面那条 expired|invalid 前面，否则会被误报成"验证码过期"
  if (/validate email|invalid format|email address.*invalid/i.test(msg)) {
    return "这个邮箱地址填得不对，检查一下有没有漏字符。";
  }
  if (/expired|invalid/i.test(msg)) {
    return "验证码不对或已过期，重新发送一封再试。";
  }
  if (/error sending|recipient/i.test(msg) || msg.trim() === "{}" || msg.trim() === "") {
    return "邮件没能发出去 —— 是发信这一侧的故障，不是你的邮箱填错了。稍后再试一次；一直这样的话把这句话截图给我们。";
  }
  return msg;
}

/** Google 官方四色 G。**这四个 hex 是品牌标识，故意不在 ink/teal 调色板里**，不要改成主题色 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function LoginForm({
  initialError,
  showGoogle = false,
}: {
  initialError?: string;
  /** 后台真的开了 Google 登录才给 true（`enabledProviders()` 现查的，不是环境变量） */
  showGoogle?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState(initialError ?? "");

  /**
   * Google 一键登录。成功的话浏览器**当场跳走**（→ Google → Supabase → /auth/callback），
   * 所以下面那个 if 只可能在失败时执行到 —— 不要在这里写 setStatus("sent") 之类的成功分支。
   */
  async function signInWithGoogle() {
    setError("");
    setStatus("google");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setStatus("idle");
        setError(friendlyError(error.message));
      }
    } catch (e) {
      // 抛出来的（断网、配置缺失）跟 return error 的是两种失败，都得接住 ——
      // 漏掉这个 catch，status 会永远卡在 "google"，两颗按钮一起变灰，只能刷新页面
      setStatus("idle");
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  }

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

  // 两条路共用一个"忙"：跳 Google 的途中不该还能点发邮件，反之亦然
  const busy = status === "sending" || status === "google";

  return (
    <div className="flex flex-col gap-3">
      {showGoogle && (
        <>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={busy}
            className="flex h-14 items-center justify-center gap-3 rounded-xl bg-ink-100 px-4 font-semibold text-ink-900 disabled:opacity-50"
          >
            <GoogleMark />
            {status === "google" ? "正在跳转 Google…" : "用 Google 登录"}
          </button>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-500/40" aria-hidden />
            <span className="text-xs text-ink-500">或者用邮箱</span>
            <span className="h-px flex-1 bg-ink-500/40" aria-hidden />
          </div>
        </>
      )}
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
          disabled={busy}
          className="mt-1 flex h-14 items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 font-semibold text-teal-950 disabled:opacity-50"
        >
          {status === "sending" ? "正在发送…" : "发送登录邮件"}
          {status !== "sending" && <span aria-hidden>→</span>}
        </button>
      </form>
      {/* 报错挪到 form 外面：Google 那条路失败时也要能显示（视觉位置不变） */}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

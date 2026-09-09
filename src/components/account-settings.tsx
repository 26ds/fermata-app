"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCopy } from "@/components/copy-provider";
import { GoogleMark } from "@/components/google-mark";

/**
 * `/settings` 的「账号」块（创始人 2026-09-09：「**在右上角设置里面添加切换账号 /
 * Google 登录功能**」）。
 *
 * ── 在此之前"换个账号"这件事根本没有入口 ──────────────────────────────────
 * 「退出登录」只在**首页右上角**有一颗，观看页/历史页/设置页都没有。人要换账号
 * 得先想到"先回首页" —— 而右上角那个齿轮才是所有页面共有的、"关于我这个账号的事
 * 都在这儿"的地方（D43 的同一条脾气：任何一次性选择都得有改回来的地方）。
 *
 * ── 两条路，不是两颗做同一件事的按钮 ────────────────────────────────────
 * ① **切换账号** = 退出 → 回登录页。到了那儿邮箱、Google 两条路都在。
 *    这一颗同时也是"退出登录" —— 所以**不再另摆一颗「退出登录」**：
 *    两颗按钮落到同一个地方，只会让人问"这两个有什么区别"。
 *    区别写在下面那句小字里，不写成第二颗按钮。
 * ② **换成 Google 账号** = 直接跳 Google 的账号选择器，省掉登录页那一站。
 *
 * ── ② 为什么**不先退出** ────────────────────────────────────────────────
 * 先退再跳看着更"干净"，实际更糟：人在 Google 那一屏点了取消，就会落在一个
 * **已经退出登录**的空壳上 —— 他什么都没改，却被踢下线了。不退的话，
 * 取消＝什么都没发生（`/auth/callback` 没拿到 code → 弹回 `/login` → 已登录 → 回首页）。
 * 换成功那一刻 `exchangeCodeForSession` 会把会话直接换掉，效果一样。
 *
 * ── `prompt: "select_account"` 是这颗按钮的命根子 ──────────────────────
 * 不带它，浏览器里只登着一个 Google 账号时 Google **会直接把那一个塞回来**，
 * 一个选择的机会都不给 —— 一颗叫「切换账号」的按钮，点下去换不了账号。
 */
export function AccountSettings({
  email,
  showGoogle,
}: {
  email: string;
  /** 后台真的开了 Google 登录才给 true（`enabledProviders()` 现查的，不是环境变量） */
  showGoogle: boolean;
}) {
  const t = useCopy();
  // 两条路共用一个"忙"：退出的途中不该还能点 Google，反之亦然。
  // 创始人 2026-09-09 那条「加载时刻用户不可以来回点」对这里同样成立
  const [busy, setBusy] = useState<"" | "switch" | "google">("");
  const [error, setError] = useState("");

  async function switchAccount() {
    setError("");
    setBusy("switch");
    try {
      const { error } = await createClient().auth.signOut();
      if (error) {
        // D44：**退不掉是要说出口的**。旧代码是 `await signOut()` 之后无条件跳
        // `/login` —— 会话还在的话 `/login` 又把人弹回首页，症状是"点了没反应"
        setBusy("");
        setError(t("settings.account.errSignOut"));
        return;
      }
      window.location.href = "/login";
    } catch {
      setBusy("");
      setError(t("settings.account.errSignOut"));
    }
  }

  async function useGoogle() {
    setError("");
    setBusy("google");
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // 见文件顶部：没有这一行，这颗按钮换不了账号
          queryParams: { prompt: "select_account" },
        },
      });
      // 成功的话浏览器**当场跳走**，下面这行只可能在失败时执行到
      if (error) {
        setBusy("");
        setError(t("settings.account.errGoogle"));
      }
    } catch {
      // 抛出来的（断网、配置缺失）跟 return error 的是两种失败，都得接住 ——
      // 漏掉这个 catch，busy 会永远卡在 "google"，两颗按钮一起变灰，只能刷新页面
      setBusy("");
      setError(t("settings.account.errGoogle"));
    }
  }

  return (
    <section
      aria-labelledby="account-settings-title"
      className="rounded-2xl border border-ink-700 px-4 py-3"
    >
      <p id="account-settings-title" className="eyebrow">
        {t("settings.account.title")}
      </p>

      {/* 邮箱理论上可以是空的（`user.email` 的类型就是可空的）。
          空的时候**整段不渲染**，别摆一行「当前登录」底下什么都没有 */}
      {email && (
        <>
          <p className="mt-2 text-xs text-ink-500">{t("settings.account.signedInAs")}</p>
          {/* 邮箱可以很长，`break-all` 是为了 375px 上不撑破卡片 */}
          <p className="mt-0.5 break-all text-sm text-ink-100">{email}</p>
        </>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {showGoogle && (
          // 白底是 Google 的品牌要求，不是这套配色里的强调色 —— 别改成 teal
          <button
            type="button"
            onClick={useGoogle}
            disabled={busy !== ""}
            className="flex min-h-11 items-center justify-center gap-2.5 rounded-xl bg-ink-100 px-4 text-sm font-semibold text-ink-900 disabled:opacity-50"
          >
            <GoogleMark size={16} />
            {busy === "google" ? t("settings.account.googleGoing") : t("settings.account.google")}
          </button>
        )}
        <button
          type="button"
          onClick={switchAccount}
          disabled={busy !== ""}
          className="flex min-h-11 items-center justify-center rounded-xl border border-ink-500/50 px-4 text-sm font-medium text-ink-300 enabled:hover:border-teal-400 enabled:hover:text-teal-300 disabled:opacity-50"
        >
          {busy === "switch" ? t("settings.account.switching") : t("settings.account.switch")}
        </button>
      </div>

      {/* 「这一颗同时也是退出登录」「东西不会丢」—— 两件人最想知道的事，
          写成一句小字，不写成第二颗按钮 */}
      <p className="mt-2.5 text-xs leading-5 text-ink-500">{t("settings.account.hint")}</p>

      {error && (
        <p className="mt-2 text-xs leading-5 text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

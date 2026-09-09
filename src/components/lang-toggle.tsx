"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useCopy, useUiLang } from "@/components/copy-provider";
import { writeUiLangCookie } from "@/lib/ui-lang-shared";

/**
 * M3.9 片 c —— **中 / EN 一键切换**（创始人 2026-09-09：「中英文按钮一键切换所有的
 * 界面语言」「每一个界面都应该有，置顶固定」）。
 *
 * ── 为什么它只切界面，不碰母语 ────────────────────────────────────────────
 * 创始人当天问过这一条，答的是「**只有界面操作语言变化**，AI 输出的答案根据自己
 * 判断（或者用户的输入语言）」。所以这颗按钮写的**只有 `uiLang` 一个键** ——
 * `nativeLang` 一个字都不动（AI 用它解释、译文译成它，那是另一条线，D42 红线）。
 *
 * ── 两段标签为什么不翻译 ──────────────────────────────────────────────────
 * 「中」和「EN」是**语言自己的写法**（endonym）。中文界面里写「中文 / 英文」、
 * 英文界面里写「Chinese / English」看着对，实际是错的：一个只读英文的人在
 * 中文界面上要找的正是「EN」这两个字母，把它写成「英文」他就认不出来了。
 * 语言开关必须用各自的语言写自己 —— `/privacy` 那颗（M3.10 之外，D70 加的）也是这么做的。
 *
 * ── 不登录也要能用 ────────────────────────────────────────────────────────
 * 登录页、`/privacy`、`/terms`、404 都没有会话，PUT 必然 401。
 * **cookie 那一层本来就够撑起整个界面**（`getUiLang` 先读 cookie），
 * 所以 401 不是失败，是这些页面的正常路径 —— 不报错、不打扰。
 */

const OPTIONS = [
  { code: "zh-Hans", label: "中" },
  { code: "en", label: "EN" },
] as const;

export function LangToggle({ className = "" }: { className?: string }) {
  const t = useCopy();
  const router = useRouter();
  const current = useUiLang();
  const [pending, startTransition] = useTransition();
  // D44：写库失败不许静默。**但只在"本该写得进去"的时候才算失败** —— 见 switchTo
  const [saveFailed, setSaveFailed] = useState(false);

  function switchTo(code: string) {
    if (code === current || pending) return;
    setSaveFailed(false);

    // ① 先写 cookie 再刷新。**顺序不能反** —— 服务端渲染读的就是这个 cookie，
    //    先刷新的话拿到的还是旧语言，界面会"点了没反应"。
    //    非 httpOnly 是 M3.9 片 b 就定好的（lib/ui-lang.ts 有说明）：里面只有一个
    //    语言码，不是凭据。
    writeUiLangCookie(code);

    // ② 立刻让服务端重渲染。整页 reload 会丢掉视频的播放位置（iframe 一重载就回到 0），
    //    `router.refresh()` 只作废服务端数据、不动已挂载的 iframe。
    startTransition(() => router.refresh());

    // ③ 再把真身写进数据库（cookie 只是镜像，**换设备靠这一步**）。
    //    不 await —— 界面已经变了，这一步慢不该让人干等着。
    //
    //    ⚠️ 这里**不用 `putSettings()`**（那个只返回 true/false），因为
    //    「没登录」和「写库炸了」必须分开：前者是登录页/法务页的正常路径，
    //    后者是要说出口的故障（D44）。分得开的唯一办法是看状态码。
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { uiLang: code } }),
    })
      .then((res) => {
        if (!res.ok && res.status !== 401) setSaveFailed(true);
      })
      .catch(() => {
        // 网络断了。cookie 已经写进去了，这台设备上语言是对的 ——
        // 但换台设备就不是，所以照样得说
        setSaveFailed(true);
      });
  }

  return (
    <div className={className}>
      <div
        role="group"
        aria-label={t("lang.toggle.aria")}
        className="flex items-center gap-0.5 rounded-full border border-ink-500/60 p-0.5"
      >
        {OPTIONS.map((o) => {
          const active = current === o.code;
          return (
            <button
              key={o.code}
              type="button"
              onClick={() => switchTo(o.code)}
              aria-pressed={active}
              // 读屏里两个字母读不出意思，补一句完整的
              aria-label={o.code === "en" ? t("lang.toggle.toEn") : t("lang.toggle.toZh")}
              className={`min-h-8 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors ${
                active
                  ? "bg-teal-400 text-teal-950"
                  : "text-ink-300 hover:bg-ink-700 hover:text-ink-100"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {saveFailed && (
        // D44：说得出是哪一种失败。**界面确实已经切了**（cookie 生效），
        // 没成的是"记进账号"这一半 —— 换台设备会变回去。别把两件事混成一句"失败了"。
        <p className="mt-1 max-w-[13rem] text-right text-[0.68rem] leading-4 text-ink-500">
          {t("lang.toggle.saveFailed")}
        </p>
      )}
    </div>
  );
}

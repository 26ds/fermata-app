"use client";

import Link from "next/link";
import { LangToggle } from "@/components/lang-toggle";
import { useCopy, useUiLang } from "@/components/copy-provider";

/**
 * `/privacy` 与 `/terms` 共用的外壳。
 *
 * **为什么双语并列，而不是跟着界面语言走**：这两页有两类读者 ——
 * 注册的人（母语各异），和 **Google 同意屏幕背后的审核**（隐私政策链接就挂在那儿，对面读英文）。
 * 只渲染一种语言的话总有一边看不懂，所以两份都在页面里，一颗按钮切着看。
 *
 * D42 要求界面文案进 `COPY` 表；**这两页是文档不是界面**，整篇塞进类型闸门只会把
 * `en.ts` 变成一部法典 —— 故不进表，双语已经在页面里各写了一份。
 *
 * ── M3.9 片 c 改了哪一处（2026-09-09）────────────────────────────────────
 * 原来这里有一颗**自己的**「中文 / English」按钮，只管这一页、用本地 state。
 * 创始人要的是「一个按钮切所有界面语言，每个界面都有」——
 * 于是这一颗换成全站那颗 `<LangToggle />`，正文跟着 `uiLang` 走。
 *
 * **两个读者都还照顾得到**：Google 审核那一侧打开时没有 cookie，
 * `getUiLang()` 会读 `Accept-Language` → 英文；中文用户读到的是中文；
 * 谁都能用同一颗按钮当场切过去。换来的是**整站只有一种切语言的方式**，
 * 而不是这一页一颗、别处又一颗。
 */
export function LegalDoc({
  zhTitle,
  enTitle,
  updated,
  zh,
  en,
}: {
  zhTitle: string;
  enTitle: string;
  /** 最后更新日期，两种语言共用一个 ISO 日期，不翻译 */
  updated: string;
  zh: React.ReactNode;
  en: React.ReactNode;
}) {
  const t = useCopy();
  // 正文跟着**全站**界面语言走。`uiLang` 只可能是 `zh-Hans` 或 `en`
  // （`UI_LOCALES` 就这两套），所以这一行判断是完备的
  const lang: "zh" | "en" = useUiLang().startsWith("zh") ? "zh" : "en";

  return (
    <main className="relative min-h-dvh px-5 py-6 sm:px-8">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-2/5 opacity-60" />

      <div className="relative mx-auto w-full max-w-2xl">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-[0.12em] text-ink-100"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-400 text-lg leading-none text-teal-950"
              aria-hidden
            >
              𝄐
            </span>
            FERMATA
          </Link>

          {/* 全站同一颗语言开关（创始人 2026-09-09：每个界面都要有） */}
          <LangToggle />
        </header>

        <div className="py-10">
          <h1 className="display-serif text-[2.1rem] leading-[1.1] tracking-[-0.03em] text-ink-100">
            {lang === "zh" ? zhTitle : enTitle}
          </h1>
          <p className="eyebrow mt-3 text-teal-300">
            {t("legal.updated")} · {updated}
          </p>

          <article className="legal-prose mt-8">{lang === "zh" ? zh : en}</article>
        </div>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-500/30 py-6 pb-[env(safe-area-inset-bottom)] text-xs text-ink-500">
          <Link href="/privacy" className="hover:text-ink-100">
            {t("login.privacy")}
          </Link>
          <Link href="/terms" className="hover:text-ink-100">
            {t("login.terms")}
          </Link>
          <a href="mailto:zq20061208@gmail.com" className="hover:text-ink-100">
            zq20061208@gmail.com
          </a>
        </footer>
      </div>
    </main>
  );
}

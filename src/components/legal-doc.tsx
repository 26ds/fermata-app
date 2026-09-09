"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * `/privacy` 与 `/terms` 共用的外壳。
 *
 * **为什么双语并列，而不是跟着界面语言走**：这两页有两类读者 ——
 * 注册的人（母语各异），和 **Google 同意屏幕背后的审核**（隐私政策链接就挂在那儿，对面读英文）。
 * 只渲染一种语言的话总有一边看不懂，所以两份都在页面里，一颗按钮切着看。
 *
 * D42 要求界面文案进 `COPY` 表；**这两页是文档不是界面**，整篇塞进类型闸门只会把
 * `en.ts` 变成一部法典 —— 故不进表，双语已经在页面里各写了一份。
 */
export function LegalDoc({
  initial,
  zhTitle,
  enTitle,
  updated,
  zh,
  en,
}: {
  /** 首屏先给哪门语言（跟着界面语言；用户随时能切） */
  initial: "zh" | "en";
  zhTitle: string;
  enTitle: string;
  /** 最后更新日期，两种语言共用一个 ISO 日期，不翻译 */
  updated: string;
  zh: React.ReactNode;
  en: React.ReactNode;
}) {
  const [lang, setLang] = useState<"zh" | "en">(initial);

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

          <div className="flex items-center gap-1 rounded-full border border-ink-500/50 p-1" role="group" aria-label="Language">
            {(["zh", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={`min-h-9 rounded-full px-3 text-xs font-semibold transition ${
                  lang === l ? "bg-teal-400 text-teal-950" : "text-ink-300 hover:text-ink-100"
                }`}
              >
                {l === "zh" ? "中文" : "English"}
              </button>
            ))}
          </div>
        </header>

        <div className="py-10">
          <h1 className="display-serif text-[2.1rem] leading-[1.1] tracking-[-0.03em] text-ink-100">
            {lang === "zh" ? zhTitle : enTitle}
          </h1>
          <p className="eyebrow mt-3 text-teal-300">
            {lang === "zh" ? "最后更新" : "Last updated"} · {updated}
          </p>

          <article className="legal-prose mt-8">{lang === "zh" ? zh : en}</article>
        </div>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-500/30 py-6 pb-[env(safe-area-inset-bottom)] text-xs text-ink-500">
          <Link href="/privacy" className="hover:text-ink-100">
            {lang === "zh" ? "隐私政策" : "Privacy Policy"}
          </Link>
          <Link href="/terms" className="hover:text-ink-100">
            {lang === "zh" ? "服务条款" : "Terms of Service"}
          </Link>
          <a href="mailto:zq20061208@gmail.com" className="hover:text-ink-100">
            zq20061208@gmail.com
          </a>
        </footer>
      </div>
    </main>
  );
}

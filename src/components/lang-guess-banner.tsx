"use client";

import Link from "next/link";
import { useState } from "react";
import { langLabel, shouldConfirmNativeLang, type LangPrefs } from "@/lib/lang";
import { putSettings } from "@/lib/settings-client";

// M3.9 片 a —— **把猜测说出口**（D42 修订① / D44）。
//
// 起因是 2026-08-01 的生产实证：创始人手机是英文的，`navigator.language` 报回 `en-US`，
// 于是他的母语被静默写成了英语 —— AI 从此用英文给一个中文母语的人写注释，
// 而他**完全无从知道这是怎么来的**。代码那次只修了"看得见"（选择器不再空白），
// 「猜了要说一声」这半件事一直欠着，这个组件就是还它。
//
// 三条设计上的硬要求：
//   ① **用猜出来的那门语言写这句话**。用他看不懂的语言告诉他"我可能猜错了你的语言"，
//      是这件事上最荒谬的失败方式 —— 他连这条横幅在说什么都读不出来。
//   ② **不是弹窗**。他打开 app 是来看视频的，不是来做语言测验的（D42：不做设置墙）。
//      一条可关的细横幅，看见了就看见了。
//   ③ **✕ 也算一个回答**。看见了并且不在意 = 确认过了，和去改一次一样算数，从此不再问。

// 这张小表是 M3.9 文案表（`src/lib/copy/`）的种子 —— 片 b 建好表之后**搬进去、这里删掉**。
// 现在单独放着是因为片 a 要先于文案表落地，而这句话恰恰是最不能等的一句。
// 没有人工文案的语言回落 `en`（D42：不假装支持 15 种）。
const MSG: Record<string, { lead: (lang: string) => string; cta: string; close: string }> = {
  "zh-Hans": {
    lead: (lang) => `你的母语现在是「${lang}」，是照你设备的语言自动填的。`,
    cta: "不对就去改",
    close: "知道了，别再提",
  },
  "zh-Hant": {
    lead: (lang) => `你的母語現在是「${lang}」，是照你裝置的語言自動填的。`,
    cta: "不對就去改",
    close: "知道了，別再提",
  },
  en: {
    lead: (lang) => `Your native language is set to ${lang} — filled in from your device's language.`,
    cta: "Not right? Change it",
    close: "Got it, stop asking",
  },
};

function pick(lang: string) {
  return MSG[lang] ?? MSG[lang.split("-")[0]] ?? MSG.en;
}

export function LangGuessBanner({ prefs, from }: { prefs: LangPrefs; from: string }) {
  const [gone, setGone] = useState(false);

  if (gone || !shouldConfirmNativeLang(prefs)) return null;

  const m = pick(prefs.nativeLang);
  const label = langLabel(prefs.nativeLang);

  const dismiss = () => {
    setGone(true); // 先收起再写 —— 写失败也不该让这条横幅赖着不走
    void putSettings({ nativeLangConfirmed: true });
  };

  return (
    <div
      // lang 属性得跟着这句话的语言走，不然读屏软件会用界面语言念它
      lang={prefs.nativeLang}
      className="mt-4 flex items-start gap-3 rounded-2xl border border-teal-400/40 bg-teal-400/[0.06] px-4 py-3"
    >
      <p className="min-w-0 flex-1 text-xs leading-5 text-ink-300">
        {m.lead(label)}{" "}
        <Link
          href={`/settings?from=${from}`}
          className="whitespace-nowrap font-semibold text-teal-300 underline underline-offset-2"
        >
          {m.cta} →
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={m.close}
        title={m.close}
        className="-my-1 -mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:text-ink-100"
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}

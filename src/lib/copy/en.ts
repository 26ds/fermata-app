import type { CopyDict } from "./keys";

// M3.9 片 b —— English copy. **Hand-written, never machine-translated**（D42 白纸黑字：
// 机翻界面很难看，不假装支持 15 种）。这一份是**兜底**：回落链最后一定落到它，
// 所以它必须是完整的 —— 底下那行 `satisfies CopyDict` 就是那道闸门，漏一条编译不过。
//
// 写英文的时候注意：**不是逐字译中文**。中文那条「不对就去改」直译成
// "If it's wrong, go change it" 很生硬；英文界面里这种地方就该是
// "Not right? Change it"。语气对得上比字面对得上重要。

export const en = {
  // ── Native-language guess banner ───────────────────────────────────────
  "lang.guess.lead": (label: string) =>
    `Your native language is set to ${label} — filled in from your device's language.`,
  "lang.guess.cta": "Not right? Change it",
  "lang.guess.close": "Got it, stop asking",

  // ── Settings · Language ────────────────────────────────────────────────
  "settings.lang.title": "Language",
  "settings.lang.saved": "Saved",
  "settings.lang.native": "My native language",
  "settings.lang.nativeHint": "What the AI explains in, and what subtitles get translated into",
  "settings.lang.target": "Language I'm learning",
  "settings.lang.targetHint": "Leave empty = I just want to understand the content",
  // 短是有原因的：375px 的 `<select>` 里只放得下约 38 个英文字符，
  // 直译中文那条括号会被截在 "…once you open som"。**被截掉的半句等于没写。**
  "settings.lang.targetUnset": "Not set yet — we'll ask you later",
  "settings.lang.targetNone": "Not learning a language — just here for the content",
  "settings.lang.ui": "Interface language",
  "settings.lang.uiFollowNative": "Follow my native language",
  "settings.lang.uiHint": "The interface is hand-written in Simplified Chinese and English only.",
  "settings.lang.uiFollow": (label: string) => `Following your native language — currently ${label}.`,
  "settings.lang.uiFallback": (native: string, actual: string) =>
    `There's no interface copy in ${native} yet, so you're seeing ${actual}.`,
  "settings.lang.uiFixed": (label: string) => `Fixed to ${label}, regardless of your native language.`,
} as const satisfies CopyDict;

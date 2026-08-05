"use client";

import { createContext, useContext, useMemo } from "react";
import { FALLBACK_UI_LOCALE, makeT, type Translate } from "@/lib/copy";

// M3.9 片 b —— 客户端拿 `t` 的地方。
//
// **provider 里只放一个字符串**（语言码），不把整张表塞进去：
// 两份字典都是 `import` 进同一个客户端 chunk 的，浏览器缓存一次就够；
// 若改成用 props 往下传表，每次导航的 RSC 载荷里都要再塞一份 —— 白花流量。

const LangContext = createContext<string>(FALLBACK_UI_LOCALE);

export function CopyProvider({ lang, children }: { lang: string; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/**
 * 组件里这样用：`const t = useCopy();` 然后 `t("settings.lang.title")`。
 *
 * ⚠️ **一个组件取一次**。字幕层是 250ms 的热路径，
 * 别在定时器回调里调 `useCopy()` 之外的取表动作（这里 memo 住了，语言不变就不重建）。
 */
export function useCopy(): Translate {
  const lang = useContext(LangContext);
  return useMemo(() => makeT(lang), [lang]);
}

/** 偶尔要知道"现在是哪门界面语言"（比如 `<html lang>` 之外还要标 lang 的地方） */
export function useUiLang(): string {
  return useContext(LangContext);
}

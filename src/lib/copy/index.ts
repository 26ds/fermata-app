import { normalizeLang } from "@/lib/lang";
import { zh } from "./zh";
import { en } from "./en";
import { zhHant } from "./zh-hant";
import type { CopyArgs, CopyDict, CopyKey } from "./keys";

export type { CopyArgs, CopyDict, CopyKey, CopyOverlay, CopyValue } from "./keys";

// M3.9 片 b —— 文案表的取值层。
//
// **为什么手写一张表、不引 next-intl**（诚实版）：next-intl 能做不带 URL 路由的模式，
// 不是做不到。但本片的实际工作量是「把几百处字符串抠出来、再人工写一份英文」——
// **这件事没有任何库能替我们干**；引它反而多一层依赖 + 多一套 provider，
// 还要考虑它和 `loading.tsx`、和 API 路由的配合。我们只有 2 种语言、
// 零复数规则、零日期本地化需求（时间戳已经是 mm:ss 和 YYYY-MM-DD），手写更小更好读。
// **接口留成 `t("key", ...)` 这个和库一样的形状**，将来真要做 15 种人工文案，换起来不难。
//
// D24：这份是纯函数 + 纯数据，客户端要 import 它，**一行服务端依赖都不许有**。

/**
 * **有完整人工文案的界面语言**，只有这两套。
 *
 * 「界面语言」选择器只许列这里面的（D42：不假装支持 15 种；D44：
 * 给一个选了等于没选的选项就是在骗人）。繁体是覆盖层不是完整套，故不在此列。
 */
export const UI_LOCALES = ["zh-Hans", "en"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

/** 兜底语言。回落链走到底一定落在这儿 —— 所以 en.ts 必须是完整的那一份 */
export const FALLBACK_UI_LOCALE: UiLocale = "en";

// 繁体 = 简体打底 + 覆盖层。模块级算一次，别每次取值都铺一遍
const ZH_HANT = { ...zh, ...zhHant } as CopyDict;

const DICTS: Record<string, CopyDict> = {
  "zh-Hans": zh,
  "zh-Hant": ZH_HANT,
  en,
};

function primaryOf(code: string): string {
  return code.split("-")[0]!.toLowerCase();
}

/**
 * 这门语言能不能落到一套我们真有的文案上。**落不上就返回 null，不硬猜**
 * —— 调用方（如 Accept-Language 那串）要靠 null 决定继不继续往下试。
 *
 * 两级：先精确码（`zh-Hant` → 繁体覆盖层），再主子标签（`en-GB` → `en`）。
 * `normalizeLang` 已经把 `zh` / `zh-CN` 收成 `zh-Hans`、把 `en-US` 削成 `en`（D42）。
 */
export function matchUiLocale(raw: string | null | undefined): string | null {
  const n = normalizeLang(raw);
  if (!n) return null;
  if (DICTS[n]) return n;
  const p = primaryOf(n);
  const byPrimary = Object.keys(DICTS).find((k) => primaryOf(k) === p);
  return byPrimary ?? null;
}

/** 同上，但一定给一个答案（落不上就英文）。渲染时用这个 */
export function resolveUiLocale(raw: string | null | undefined): string {
  return matchUiLocale(raw) ?? FALLBACK_UI_LOCALE;
}

/** 取一整份文案表。认不出的语言落英文 —— **永远不会露出 key** */
export function getCopy(lang: string | null | undefined): CopyDict {
  return DICTS[resolveUiLocale(lang)]!;
}

/** `t` 的类型。组件里想把它往下传时标这个 */
export type Translate = <K extends CopyKey>(key: K, ...args: CopyArgs<K>) => string;

/**
 * 造一个 `t`。服务端组件 / API 路由直接用（不经过 React）；
 * 客户端组件走 `useCopy()`（`src/components/copy-provider.tsx`），那边会 memo 住。
 *
 * ⚠️ **别在定时器或每帧回调里调 `makeT`** —— 字幕层是 250ms 的热路径，
 * 组件里取一次 `t` 存着用就行。
 */
export function makeT(lang: string | null | undefined): Translate {
  const dict = getCopy(lang);
  return <K extends CopyKey>(key: K, ...args: CopyArgs<K>): string => {
    const v = dict[key];
    return typeof v === "function" ? (v as (...a: unknown[]) => string)(...args) : (v as string);
  };
}

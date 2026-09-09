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
 * 在给定的一池语言里找最接近的。**落不上就返回 null，不硬猜**
 * —— 调用方（如 Accept-Language 那串）要靠 null 决定继不继续往下试。
 *
 * 两级：先精确码，再主子标签（`en-GB` → `en`；`zh-Hant` 在只有简体的池子里 → `zh-Hans`）。
 * `normalizeLang` 已经把 `zh` / `zh-CN` 收成 `zh-Hans`、把 `en-US` 削成 `en`（D42）。
 */
function matchIn(pool: readonly string[], raw: string | null | undefined): string | null {
  const n = normalizeLang(raw);
  if (!n) return null;
  if (pool.includes(n)) return n;
  const p = primaryOf(n);
  return pool.find((k) => primaryOf(k) === p) ?? null;
}

const COPY_LOCALES = Object.keys(DICTS);

/**
 * **界面**用哪门语言。池子只有 `UI_LOCALES`（有整套人工文案的那两种）。
 *
 * ⚠️ **和下面那个 `matchCopyLocale` 差在哪，为什么必须分开** —— 这是 2026-08-05
 * 创始人真机上撞出来的洞：繁体只是**覆盖层**（三句话），不是一套界面文案。
 * 早先两者共用一个池子，于是「母语选繁體中文 + 界面跟着母语」会解析成 `zh-Hant`，
 * 界面变成**三句繁体 + 其余全是简体的混合体** —— 那正是我在 zh-hant.ts 的注释里
 * 白纸黑字说"比不给这个选项更糟"的东西，我却只在选择器那一头堵了，
 * **忘了母语选择器是另一条能通到同一处的路**。
 * 现在界面这条路只认完整的两套，繁体母语 → 界面用简体（整套简体，不混）。
 */
export function matchUiLocale(raw: string | null | undefined): string | null {
  return matchIn(UI_LOCALES, raw);
}

/** 同上，但一定给一个答案（落不上就英文）。**决定整个界面用什么语言时用这个** */
export function resolveUiLocale(raw: string | null | undefined): string {
  return matchUiLocale(raw) ?? FALLBACK_UI_LOCALE;
}

/**
 * **某一句话**该用哪门语言 —— 池子包含覆盖层（繁体在内）。
 *
 * 只给"这句话必须用某门指定语言说"的场合用，全站目前只有一处：
 * 母语猜测横幅（它要用**猜出来的那门母语**说，见 lang-guess-banner.tsx）。
 * **别拿它决定整个界面用什么语言** —— 那就是上面说的那个洞。
 */
export function resolveCopyLocale(raw: string | null | undefined): string {
  return matchIn(COPY_LOCALES, raw) ?? FALLBACK_UI_LOCALE;
}

/** 取一整份文案表。认不出的语言落英文 —— **永远不会露出 key** */
export function getCopy(lang: string | null | undefined): CopyDict {
  return DICTS[resolveCopyLocale(lang)]!;
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

/**
 * 这个字符串是不是一条真的文案 key（M3.9 片 c）。
 *
 * **为什么需要它**：`zod` 的 `.min(1, "…")` 挂在**模块级常量**上，
 * 那时候拿不到"这个人用什么语言看界面"。所以 schema 里挂的是 **key**
 * （`"err.needUrl"`），出错时在路由里翻。
 * 但 zod 自己也会产生消息（`"Invalid input"` 之类），那些不是 key ——
 * 所以翻之前先问一句，不是 key 就原样奉还，**绝不把 `err.needUrl` 这种东西显示给人看**。
 */
export function isCopyKey(s: string | null | undefined): s is CopyKey {
  return typeof s === "string" && s in zh;
}

/** 翻一条"可能是 key、也可能是现成人话"的消息。见 `isCopyKey` */
export function tMaybeKey(t: Translate, message: string | null | undefined, fallback: CopyKey): string {
  if (isCopyKey(message)) return t(message);
  return message?.trim() ? message : t(fallback);
}

/**
 * 用一个**运行时才知道**的 key + 一串运行时参数取文案（M3.9 片 c）。
 *
 * 正常情况下 `t("a.b", x)` 的参数是**类型推出来的**（见 keys.ts 的 `CopyArgs`），
 * 那是这张表最值钱的一道闸门，别绕开它。这个函数是给一种绕不开的场合用的：
 * 服务端库（如 `lib/sources/podcast.ts`）抛错时带一个 key 上来，
 * 路由拿到的是 `string` + `unknown[]`，**编译期无从对齐**。
 *
 * 所以那个 `as` 就集中在这一处、写明白理由，而不是散在每个调用点。
 * key 不认识就返回 null，由调用方决定兜底 —— **绝不把 `podcast.errFetch`
 * 这种东西显示给人看**。
 */
export function tDynamic(
  lang: string | null | undefined,
  key: string | null | undefined,
  args: readonly unknown[] = [],
): string | null {
  if (!isCopyKey(key)) return null;
  const v = getCopy(lang)[key];
  return typeof v === "function" ? (v as (...a: unknown[]) => string)(...args) : (v as string);
}

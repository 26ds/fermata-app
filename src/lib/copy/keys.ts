import type { zh } from "./zh";

// M3.9 片 b —— 文案表的类型层。**本片最重要的几行代码就在这儿**。
//
// 中文那份（zh.ts）是 key 的唯一来源；英文那份必须 `satisfies CopyDict`，
// **漏译一条就编译不过**。i18n 最常见的烂法是"漏了一条谁也没发现，
// 直到某个用户在某个页面看见一句异国文字"——那种东西不该靠人眼查。

/** 一条文案：写死的字符串，或者吃参数拼出来的字符串 */
export type CopyValue = string | ((...args: never[]) => string);

/** 所有 key。中文那份写了什么，这里就有什么 */
export type CopyKey = keyof typeof zh;

/** 中文那份的精确形状 —— 英文那份要按它逐条对齐（含函数签名） */
export type CopyShape = typeof zh;

/**
 * 一份**完整**的文案表。
 *
 * ⚠️ 不能直接写成 `{ [K in CopyKey]: CopyShape[K] }` —— `zh.ts` 是 `as const`，
 * 那样每条的类型是**那句中文字面量本身**（`"语言"`），于是英文那份写 `"Language"`
 * 会被判成"类型不符"。这里把字符串放宽成 `string`，
 * **但函数的参数照抄** —— 中文那条要 `(label: string)`，英文那条也得要，
 * 不然调用处传的参数会对不上，而那种错到运行时才看得见。
 */
export type CopyDict = {
  readonly [K in CopyKey]: CopyShape[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : string;
};

/**
 * 一份**覆盖层**（如繁体中文）：只写和它的"底"不一样的那几条，其余落回去。
 * 允许残缺 —— 这正是它和 CopyDict 的区别：**残缺的不许当成一门界面语言列出来**，
 * 只用来托住已经写好的那几句（见 index.ts 的 ZH_HANT）。
 */
export type CopyOverlay = Partial<CopyDict>;

/** `t("a.b", ...)` 该收几个参数：值是函数就照抄它的参数，是字符串就一个都不收 */
export type CopyArgs<K extends CopyKey> = CopyShape[K] extends (...args: infer A) => string
  ? A
  : [];

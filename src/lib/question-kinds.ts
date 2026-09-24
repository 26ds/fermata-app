import type { QuestionKind } from "@/lib/types";

// M3.15 片 d 的另一半 —— D65 问题三分类：**语言 / 知识 / 没听清**，一个问题可以同时属于几类。
//
// 标签从哪来：**答题那一次调用顺带吐出来**（答案最后一行 `[[KINDS]] …`，`lib/ask/refs.ts` 拆、`/api/ask` 存）——
// 不另开一次调用，不多花一分钱、不多等一秒。用户点一下就能改（D45：用户一指就说清的事，不让模型说了算）。
//
// **2026-09-23 创始人选 A**：三类照分、照存，但「语言」这一类**只在设了想学的语言时才在界面上露出来**
// （他第一轮原话是「当用户开启多语言学习功能后」）。没设的账号上「语言」照样存着 —— 哪天设了，历史问题的标签立刻就在。
//
// 这是客户端和服务端共用的**唯一**一份：类别白名单、界面顺序、读库里的值、点一下开关之后变成什么。纯函数，Node 直接能测。

/** 界面上的顺序，也是存库时排好的顺序（计划 §G 那张表就是这个顺序） */
export const QUESTION_KINDS = ["language", "knowledge", "misheard"] as const satisfies readonly QuestionKind[];

const isKind = (v: unknown): v is QuestionKind =>
  typeof v === "string" && (QUESTION_KINDS as readonly string[]).includes(v);

/** 去重、按界面顺序排 —— 同一组标签不管怎么点出来的，存进库里都长一个样 */
export function normalizeKinds(list: readonly QuestionKind[]): QuestionKind[] {
  return QUESTION_KINDS.filter((k) => list.includes(k));
}

/**
 * 库里 / 接口里来的值 → 标签。
 * **不是数组 = null（没标过：老问题、手机上问的、模型那一次没写）**；空数组 = 标过、一类都不沾（或者他自己全去掉了）。
 * 数组里认不出的值丢掉 —— jsonb / text[] 里躺着什么别全信。
 */
export function readKinds(v: unknown): QuestionKind[] | null {
  if (!Array.isArray(v)) return null;
  return normalizeKinds(v.filter(isKind));
}

/** D65 选 A：界面上露哪几类。**没设想学的语言就不露「语言」** */
export function visibleKinds(showLanguage: boolean): readonly QuestionKind[] {
  return showLanguage ? QUESTION_KINDS : QUESTION_KINDS.filter((k) => k !== "language");
}

/** 这一问在界面上显示哪几个标签 = 存着的 ∩ 露得出来的 */
export function shownKinds(kinds: unknown, showLanguage: boolean): QuestionKind[] {
  const have = readKinds(kinds) ?? [];
  const vis = visibleKinds(showLanguage);
  return have.filter((k) => vis.includes(k));
}

/**
 * 点一个开关：有就去掉、没有就加上。
 * ⚠️ **藏着的那一类原样留着** —— 没设想学的语言时「语言」不露面，但他改「知识」不该顺手把存着的「语言」抹掉（A 的本意）。
 */
export function toggleKind(kinds: unknown, k: QuestionKind): QuestionKind[] {
  const cur = readKinds(kinds) ?? [];
  return normalizeKinds(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
}

/** 两组标签是不是一回事（顺序无关 —— 都先 normalize 过） */
export function sameKinds(a: unknown, b: unknown): boolean {
  const x = readKinds(a);
  const y = readKinds(b);
  if (x === null || y === null) return x === y;
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

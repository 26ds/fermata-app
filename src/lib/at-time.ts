// M3.15 片 d —— 在输入框里打 `@` 指定另一个时间点提问（计划 §J / **D69**）。
//
// 创始人原话：「可以的，**但是要让用户知道这个功能**；而且**可以自动跳出前面提问/暂停过没提问的时间点**，
// 当然也可以自己输入」。
//
// ── 为什么这一坨是纯函数、住在 lib 里 ──────────────────────────────────────
// ① Node 直接跑得了单元测试（工具箱第 5 节的办法）——「敲一个超出时长的时间**当场说不对**」
//    是计划写死的交付判据，那种东西不该靠人眼在浏览器里点；
// ② **`@` 这一段的判据只有这一份**。输入框要拿它决定「单子开不开 / 芯片显不显示」，
//    发送那一刻要拿它决定「这一轮记在第几秒」—— 两处各写一遍迟早漂移，
//    而漂移的症状是「芯片上写着 12:34，点却落在 25:03」，用户看不出来是两套代码。
//
// ── 中文输入法（计划 §J 最后那条 ⚠️）────────────────────────────────────────
// 「中文输入法下的 `@` 必须实测 —— `keydown` 拿到的未必是你以为的那个键」。
// **这里的对策是从根上绕开 keydown**：单子开不开只看**输入框里现在是什么字**（`onChange` 的 value），
// 不看按了哪个键。输入法上屏之后 value 一定是对的，所以候选词那条路走不歪。
// 另外两样中文键盘真的会打出来的字，这里一并认：全角冒号 `：` 和全角 `＠`
// （macOS 中文输入法下 Shift+2 出的是半角 `@`，但冒号按下去就是全角 —— `@12：34` 是真会发生的输入）。

import { parseClock } from "@/lib/ask/refs";
import type { PausePoint } from "@/components/pause-list";

/** 时间那一截允许出现的字：数字、半角/全角冒号、小数点。**字母一个都不许** —— 见下面 `readAt` */
const TIME_CHARS = /^[0-9:：.]*$/;

/** 行首那个 `@`（半角或全角），前面允许有空白 */
const AT_HEAD = /^\s*[@＠]/;

/** 把中文键盘打出来的全角冒号换成半角，好交给 `parseClock`（`refs.ts` 那一份，和概述卡同一个口径） */
const halfWidth = (s: string): string => s.replace(/：/g, ":");

/**
 * 输入框里现在是不是**正在打那个时间**（`@`、`@12`、`@12:3`…，后面还没跟上空格）。
 * 是 → 单子浮出来。**只看 value，不看按键**（见文件头「中文输入法」那段）。
 */
export function isTypingAt(input: string): boolean {
  const m = AT_HEAD.exec(input);
  if (!m) return false;
  return TIME_CHARS.test(input.slice(m[0].length));
}

/** 一句话读出来的结果 */
export interface AtRead {
  /** 指定的那一秒。null = 没指定（或者写错了，看 `error`） */
  at: number | null;
  /** 去掉 `@12:34` 之后真正要问的那句话 —— **喂给 AI 和落库的都是它**（时间由这一轮的点带着，不必写在问句里） */
  question: string;
  /**
   * `bad` = 他在写时间但写歪了（`@12:99`、`@1:2:3:4`）；
   * `range` = 写对了但超出这支片子的长度。
   * **两种都当场说清楚，不许闷着按当前播放头算**（D44，计划 §J 第 3 条）。
   */
  error: "bad" | "range" | null;
}

/**
 * 从一句话里读出「指定了第几秒 + 真正的问题」。
 *
 * ⚠️ **只认行首**：`@` 长在中间（"问问 @dang 那句"）不当时间 —— 那是他在打字，不是在指时间。
 * ⚠️ **`@` 后面不是数字就当普通字**（`@somebody`）：人名、账号照样打得出来，
 *    不然「想指定却写歪了」和「本来就没想指定」两件事会混成一件，而报错只该给前者看。
 */
export function readAt(input: string, durationS: number): AtRead {
  const m = AT_HEAD.exec(input);
  if (!m) return { at: null, question: input.trim(), error: null };

  const rest = input.slice(m[0].length);
  // `@12:34 剩下的问题` —— 空白之前那一截是时间
  const cut = rest.search(/\s/);
  const timeText = cut < 0 ? rest : rest.slice(0, cut);
  const question = (cut < 0 ? "" : rest.slice(cut)).trim();

  // `@` 后面压根不是数字开头 → 他在打别的，不是在指时间
  if (!/^[0-9]/.test(timeText)) return { at: null, question: input.trim(), error: null };
  // 数字里混进了别的字（`@12a`）→ 想指定、写歪了
  if (!TIME_CHARS.test(timeText)) return { at: null, question, error: "bad" };

  const t = parseClock(halfWidth(timeText));
  if (t === null) return { at: null, question, error: "bad" };
  // 夹 1 秒：时长本身是四舍五入来的，片尾最后一秒不该被判成「超出」
  if (t < 0 || (durationS > 0 && t > durationS + 1)) return { at: null, question, error: "range" };
  return { at: t, question, error: null };
}

/** 把选中的那一秒写回输入框：`@12:34 ` + 他已经打了的那句话 */
export function withAt(input: string, label: string): string {
  const m = AT_HEAD.exec(input);
  if (!m) return `@${label} ${input.trimStart()}`;
  const rest = input.slice(m[0].length);
  const cut = rest.search(/\s/);
  const tail = cut < 0 ? "" : rest.slice(cut).trimStart();
  return `@${label} ${tail}`;
}

/** 把 `@12:34` 从输入框里摘掉，剩下的话原样留着（点「@现在」= 不指定） */
export function withoutAt(input: string): string {
  const m = AT_HEAD.exec(input);
  if (!m) return input;
  const rest = input.slice(m[0].length);
  const cut = rest.search(/\s/);
  if (cut < 0) return /^[0-9]/.test(rest) ? "" : input;
  return /^[0-9]/.test(rest.slice(0, cut)) ? rest.slice(cut).trimStart() : input;
}

/** 单子里的一行 */
export interface AtEntry {
  /** 第几秒 */
  tS: number;
  /** 问过的 = 那句问题原文；停过没问的 = null（界面上写「停过，没问」） */
  question: string | null;
}

/** 单子最多这么长 —— 再多就是一堵墙，而他要找的那一条八成在最近几条里（长的那半在单子里能滚） */
export const MAX_AT_ENTRIES = 12;

/**
 * 单子里都有谁（计划 §J 第 1 条）：**来源就是 `interrupts`，和问题列表同一份数据，不另存一份**。
 * 问过的带问题原文，停过没问的（`question` 空）也在 —— 那一类是创始人自己点名要的。
 *
 * 排序：**秒数从大到小**（计划里那张图就是这个次序：12:34 / 08:02 / 03:17）。
 * 同一秒有好几个点（追问）→ 只留一个，带问题的那个优先（空的那条在单子里说不出什么）。
 */
export function atEntries(points: readonly PausePoint[], nowS: number): AtEntry[] {
  const bySecond = new Map<number, AtEntry>();
  for (const p of points) {
    const tS = Math.max(0, Math.floor(p.t_s));
    // 「现在」在单子最上面单独有一行，这儿不重复出一条
    if (Math.abs(tS - Math.floor(nowS)) < 1) continue;
    const question = (p.question ?? "").trim() || null;
    const had = bySecond.get(tS);
    if (!had) bySecond.set(tS, { tS, question });
    else if (!had.question && question) bySecond.set(tS, { tS, question });
  }
  return [...bySecond.values()].sort((a, b) => b.tS - a.tS).slice(0, MAX_AT_ENTRIES);
}

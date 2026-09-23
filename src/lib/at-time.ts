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
//
// ── 🐞6 + 「往回倒」（2026-09-23 修，他在预览站上真撞到的）─────────────────────
// 他打过 `@- 23`、`@-15:03`：旧版一看 `@` 后面不是数字就当普通字 —— **闷着**记在了当时的播放头 23:01，
// 单子还当场收了、下面也不报错，两头都是哑的（违反 D69「格式不对当场说清楚」）。`@ 15:03`（空一格）同一个口子。
// 他当天拍了减号的意思：「-13设置成减去秒数吧，然后发送完就是显示的是…真实时间分钟秒数 = 原来的 -13这样子」——
// 所以 **`@-13` = 从现在往回倒 13 秒**，界面上永远显示**换算好的那一秒**（`@22:48`），不显示「-13」。
// 「现在」= 发送那一刻的播放头（和不打 `@` 时记的那一秒同一个口径）。

import { parseClock } from "@/lib/ask/refs";
import type { PausePoint } from "@/components/pause-list";

/** 时间那一截允许出现的字：数字、半角/全角冒号、小数点。**字母一个都不许** —— 见下面 `readAt` */
const TIME_CHARS = /^[0-9:：.]*$/;

/**
 * 行首那个 `@`（半角或全角，前面允许有空白）+ 后面那一截时间。拆成三块：
 * ① `@` 后面允许空格（`@ 15:03` —— ⒠）；② 可选的正负号，号后面也允许空格（他真打过 `@- 23`）；③ 到下一个空白为止的那一截。
 *
 * 减号认一串：半角 `-`、全角 `－`、en dash `–`、em dash `—`、数学减号 `−` —— 中文输入法按减号这几种都出得来，
 * Shift+减号出的还是**两个** em dash「——」。加号只为了能说「只能往回倒」，不为了往后跳（⒟）。
 * 空格只认同一行里的（`[^\S\n]`）：`@` 后面直接回车，不该把下一行当成时间。
 */
const HEAD = /^\s*[@＠][^\S\n]*(?:([-－–—−]+|[+＋])[^\S\n]*)?(\S*)/;

/** 同一套写法，**还没打完**的样子：`@`、`@ `、`@-`、`@- 1`、`@12:3` —— 后面还没跟空格 */
const TYPING = /^\s*[@＠][^\S\n]*(?:[-－–—−]+[^\S\n]*)?[0-9:：.]*$/;

/** 把中文键盘打出来的全角冒号换成半角，好交给 `parseClock`（`refs.ts` 那一份，和概述卡同一个口径） */
const halfWidth = (s: string): string => s.replace(/：/g, ":");

interface Head {
  /** `@…时间` 那一截在输入框里到哪儿为止（含行首的空白）—— 后面就是真正要问的那句话 */
  end: number;
  sign: "-" | "+" | null;
  /** 时间那一截原样（可能是空的、可能写歪了） */
  timeText: string;
}

function splitHead(input: string): Head | null {
  const m = HEAD.exec(input);
  if (!m) return null;
  const sign = m[1] ? (/[+＋]/.test(m[1]) ? "+" : "-") : null;
  return { end: m[0].length, sign, timeText: m[2] };
}

/**
 * 这一截**是不是在写时间**（而不是 `@maverick` 这种人名）。
 * 带了正负号就算（没人会写 `@-somebody`）；什么都没写也算（刚打了一个 `@`，替换 / 摘掉它都该连 `@` 一起）。
 */
const timeish = (h: Head): boolean => h.sign !== null || h.timeText === "" || /^[0-9]/.test(h.timeText);

/**
 * 输入框里现在是不是**正在打那个时间**（`@`、`@12`、`@12:3`、`@-`、`@- 1`、`@ `…，后面还没跟上空格）。
 * 是 → 单子浮出来。**只看 value，不看按键**（见文件头「中文输入法」那段）。
 * ⚠️ 🐞6 的一半就在这儿：旧版一见 `-` 就把单子收了，他打 `@-15:03` 的时候单子消失、下面也不报错。
 * `@+` 故意不算「还在打」—— 那条路走不通，让报错当场出来（「只能往回倒」），比让他打完再说强。
 */
export function isTypingAt(input: string): boolean {
  return TYPING.test(input);
}

/**
 * 往回倒 `back` 秒落在第几秒。「现在」往下取整 —— 和不打 `@` 时记的那一秒同一个口径（`qa-chat.tsx` 的 `send`）。
 * 倒过了片头就**夹在 00:00**，并且说一声（`clamped`，芯片上写「到片头了」）—— 和播放器的 −10 秒按钮一个脾气（⒞）。
 */
export function rewindTo(nowS: number, back: number): { at: number; clamped: boolean } {
  const at = Math.max(0, Math.floor(nowS)) - back;
  return at < 0 ? { at: 0, clamped: true } : { at, clamped: false };
}

/** 一句话读出来的结果 */
export interface AtRead {
  /**
   * 指定的那一秒。null = 没指定（或者写错了，看 `error`）。
   * 往回倒的（`@-13`）这里已经是**换算好的那一秒** —— 发送那一刻拿它落点，和绝对时间走同一条路。
   */
  at: number | null;
  /**
   * `@-13` → 13（往回倒了几秒）；不是往回倒 → null。
   * 芯片靠它**跟着播放头走**：视频在播，「现在」每秒都在变，换算出来的那一秒也得跟着变（⒝）。
   */
  back: number | null;
  /** 往回倒过了片头、夹到了 00:00（芯片上要写明「到片头了」，不许闷着改他的数） */
  clamped: boolean;
  /** 去掉 `@12:34` / `@-13` 之后真正要问的那句话 —— **喂给 AI 和落库的都是它**（时间由这一轮的点带着，不必写在问句里） */
  question: string;
  /**
   * `bad` = 他在写时间但写歪了（`@12:99`、`@1:2:3:4`、`@-abc`）；
   * `range` = 写对了但超出这支片子的长度；
   * `forward` = 写了 `@+13` —— 只能往回倒（他没要往后，⒟）。
   * **三种都当场说清楚，不许闷着按当前播放头算**（D44，计划 §J 第 3 条）。
   */
  error: "bad" | "range" | "forward" | null;
}

/** 没指定时间点：整句话就是问题 */
export function notPinned(input: string): AtRead {
  return { at: null, back: null, clamped: false, question: input.trim(), error: null };
}

/**
 * 从一句话里读出「指定了第几秒 + 真正的问题」。`nowS` = 此刻的播放头（只有 `@-13` 用得着它）。
 *
 * ⚠️ **只认行首**：`@` 长在中间（"问问 @dang 那句"）不当时间 —— 那是他在打字，不是在指时间。
 * ⚠️ **`@` 后面是字母就当普通字**（`@somebody`）：人名、账号照样打得出来，
 *    不然「想指定却写歪了」和「本来就没想指定」两件事会混成一件，而报错只该给前者看。
 *    **但减号 / 加号不在此列**（🐞6）：`@-…` 一定是在写时间，写歪了要说。
 */
export function readAt(input: string, durationS: number, nowS: number): AtRead {
  const h = splitHead(input);
  if (!h) return notPinned(input);
  const question = input.slice(h.end).trim();
  const fail = (error: "bad" | "range" | "forward"): AtRead => ({ at: null, back: null, clamped: false, question, error });

  if (h.sign === "+") return fail("forward");
  // `@` 后面压根不是数字开头、也没有正负号 → 他在打别的，不是在指时间
  if (h.sign === null && !/^[0-9]/.test(h.timeText)) return notPinned(input);
  // 数字里混进了别的字（`@12a`）、或者减号后面没跟数字（`@-abc`）→ 想指定、写歪了
  if (!h.timeText || !TIME_CHARS.test(h.timeText)) return fail("bad");

  const t = parseClock(halfWidth(h.timeText));
  if (t === null) return fail("bad");
  if (h.sign === "-") {
    // `@-1:30` = 往回 1 分 30 秒（同一个 parseClock；芯片上看得见换算结果）
    const r = rewindTo(nowS, t);
    return { at: r.at, back: t, clamped: r.clamped, question, error: null };
  }
  // 夹 1 秒：时长本身是四舍五入来的，片尾最后一秒不该被判成「超出」
  if (t < 0 || (durationS > 0 && t > durationS + 1)) return fail("range");
  return { at: t, back: null, clamped: false, question, error: null };
}

/** 把选中的那一秒写回输入框：`@12:34 ` + 他已经打了的那句话（原来那一截 `@…` 整个换掉，含 `@-13`） */
export function withAt(input: string, label: string): string {
  const h = splitHead(input);
  if (!h || !timeish(h)) return `@${label} ${input.trimStart()}`;
  return `@${label} ${input.slice(h.end).trimStart()}`;
}

/** 把 `@12:34` / `@-13` 从输入框里摘掉，剩下的话原样留着（点「@现在」= 不指定）。`@人名` 不动它 */
export function withoutAt(input: string): string {
  const h = splitHead(input);
  if (!h || !timeish(h)) return input;
  return input.slice(h.end).trimStart();
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

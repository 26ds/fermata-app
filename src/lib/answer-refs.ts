// M3.15 片 c —— 概述卡（计划 §二 / D64）：答案里「视频别处还讲到」的那几条，结构化之后长什么样。
//
// **服务端（`lib/ask/refs.ts` 核对、吸附、拼进要落库的全文）和界面（`ref-cards.tsx` 画卡片、`qa-chat.tsx` 拆全文）共用这一份** ——
// 两边各写一遍，迟早一边改了另一边没改：存进库的那几行字就拆不回来，同一张卡会在答案里再出现一遍。
// D24：纯函数，客户端要 import，一行服务端依赖都不许有。
//
// ── 为什么全文里还留着一份文字版（`refsText`）────────────────────────────────
// `interrupts.ai_answer` 不止问答栏在读：历史页（`/library/[id]` 的暂停点列表）、「看画面再答」喂给模型的上一版、
// 以后的复习 / Takeaway 都读它。以前指路那一段是模型写在答案里的一段话，这些地方都看得见；
// 片 c 把它拆成了卡片 —— 要是全文里不留，那些地方就**悄悄少了一段**（D44 最不许的那种）。
// 所以落库的全文 = 正文 + 空一行 + 每张卡一行字；问答栏拿同一个 `refsText` 把尾巴认出来、拆掉、换成卡片。

import { mmss } from "@/lib/time";

/** 一张概述卡。落库在 `interrupts.refs`（迁移 0011 就留好的 jsonb 列）—— 一轮问答一个数组 */
export interface AnswerRef {
  /** 点卡片跳到哪一秒：核对上了 = 那句字幕**真正开始**的那一秒（吸附过的）；核不上 = null（卡片不可点） */
  t_s: number | null;
  /** 模型自己写的是第几秒（照抄它给的 MM:SS）。留着对账：将来查「它编过几次时间」要有据可查（D64） */
  claimed_s: number | null;
  /** 模型给的原句（它说是从字幕里抄的） */
  quote: string;
  /** 核对上了：字幕里真正的那几个字（字幕自己的大小写和标点）。核不上 = null */
  line: string | null;
  /** 一句话：那儿讲了什么（AI 写的，和回答同一门语言） */
  note: string;
  /** 在字幕里核对上了吗 */
  ok: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * 从库里读 `refs`（jsonb，**别信它躺着的形状**）。
 * 不是数组 = 这一轮不是片 c 之后按卡片问的（老数据、手机上问的、`refs` 为 null）→ 返回 null，界面照老样子只显示全文。
 */
export function readRefs(raw: unknown): AnswerRef[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AnswerRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ok = o.ok === true && num(o.t_s) !== null;
    out.push({
      t_s: ok ? num(o.t_s) : null,
      claimed_s: num(o.claimed_s),
      quote: str(o.quote),
      line: ok && typeof o.line === "string" ? o.line : null,
      note: str(o.note),
      ok,
    });
  }
  return out;
}

/** 卡片上写的时间：核对上了是吸附后的那一秒，核不上是模型自己说的那一秒（灰着、不可点） */
export function refTime(r: AnswerRef): number | null {
  return r.ok ? r.t_s : r.claimed_s;
}

/** 卡片上引的那一句：核对上了用字幕自己的字，核不上只能照登模型给的 */
export function refQuote(r: AnswerRef): string {
  return (r.ok ? r.line : null) ?? r.quote;
}

/**
 * 每张卡一行字，拼在落库全文的末尾 —— 给**不画卡片**的地方看（历史页等，见文件头）。
 * 不写「后面 / 前面」这类字：那是界面的字（跟界面语言走），而这几行是答案的一部分（跟回答语言走）——
 * 写死哪一门都会在另一门的答案里夹一句外语。时间 + AI 那一句 + 原句，三样都不用翻。
 */
export function refsText(refs: readonly AnswerRef[]): string {
  return refs
    .map((r) => {
      const at = refTime(r);
      const quote = refQuote(r);
      return [at === null ? "" : `${mmss(at)} · `, r.note, quote ? `${r.note ? " " : ""}“${quote}”` : ""].join("");
    })
    .join("\n");
}

/**
 * 把一轮的全文拆成「正文」和「卡片」。
 * 全文末尾正好是 `refsText(refs)` 那几行 → 拆掉，交给卡片画；**对不上就不拆**：宁可让他多看见一遍，也别吞字。
 */
export function splitAnswer(answer: string, refs: readonly AnswerRef[] | null): { body: string; refs: AnswerRef[] } {
  if (!refs || refs.length === 0) return { body: answer, refs: [] };
  const tail = `\n\n${refsText(refs)}`;
  if (answer.endsWith(tail)) return { body: answer.slice(0, -tail.length), refs: [...refs] };
  return { body: answer, refs: [...refs] };
}

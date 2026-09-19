// M3.15（D77，2026-09-19 创始人选 A）—— 问答要记得这段对话。
//
// 以前 `/api/ask` 每一问都当第一问答：模型手里只有字幕和这一句，之前几轮一个字没有。
// 最受罪的是答完之后那两颗快捷按钮 ——「为什么会这样？」「这跟他刚才讲的那一段是什么关系？」离开上一个答案根本不成话，
// 追问里的「他」「这个」也只能靠字幕猜。
//
// 现在宽屏问答栏的每一问，把 ① 它追问的母问题那一轮（`parent_id`）② 这条内容**这一轮之前**最近三轮 一起交给模型（去重、按提问先后）。
// 仍是一问一次调用、不多一次点击，只是每次多发几百个字。手机暂停面板不带（D35 那条短问答仍然独立）；滚动摘要（`chats.summary`）仍归片 e。
//
// 纯函数（不 import server-only）：路由从 `interrupts` 取行，这里只管挑、排、拆、截 —— Node 直接能测（工具箱第 8 节）。

import { readRefs, splitAnswer } from "@/lib/answer-refs";

/** 这一轮之前最近几轮（D77：三轮）。母问题那一轮不算在这三轮里 —— 它更早的话另外带上，最多四轮 */
export const RECENT_TURNS = 3;

/**
 * 每一轮的答案截到这么长（问题全留）。生产库 67 条答案（2026-09-19 量的）：中位 196 字、均值 233 字 —— 大多数原样带上。
 * 截的是「看了画面的那一版」（均值 703 字）和少数长答案。
 */
export const ANSWER_CAP = 300;

/**
 * 最近那一轮多给一些：快捷按钮只挂在最后一轮下面，「为什么会这样？」说的就是它 ——
 * 它要是被截在半路，这一问就又接不上了。800 字够装下生产库里最长的只看字幕答案（853 字）的绝大部分
 */
export const LATEST_ANSWER_CAP = 800;

/** 路由取回来的一行 `interrupts`（`select("*")`：0013 没跑的库上没有 `ai_answer_visual`，那就当没有画面版） */
export interface HistoryRow {
  id: string;
  t_s: number | string;
  question: string | null;
  ai_answer: string | null;
  ai_answer_visual?: string | null;
  refs?: unknown;
  created_at: string;
}

/** 交给模型的一轮 */
export interface PastTurn {
  /** 那一问卡在第几秒 */
  tS: number;
  question: string;
  /** 已经拆掉卡片文字版、截过的答案 */
  answer: string;
  /** 答案是「看了画面」的那一版（D75：有画面版时界面默认显示它，他读到的就是这一版） */
  visual: boolean;
  /** 母问题：这一串追问的第一问（`parent_id` 指的那一轮 —— 追问的追问也挂在它下面，不是紧挨着的上一轮） */
  parent: boolean;
}

/**
 * 截到 `cap` 字以内，尽量断在句末（后 40% 里找最后一个句号 / 问号 / 叹号 / 换行），断了就补「…」。
 * 按字符（code point）数，别把一个 emoji 切成两半
 */
export function clipAnswer(text: string, cap: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= cap) return chars.join("");
  const head = chars.slice(0, cap);
  for (let i = head.length - 1; i >= Math.floor(cap * 0.6); i--) {
    if (/[。！？!?\n]/.test(head[i]) || (head[i] === "." && (i + 1 >= chars.length || /\s/.test(chars[i + 1])))) {
      return `${head.slice(0, i + 1).join("").trimEnd()}…`;
    }
  }
  return `${head.join("").trimEnd()}…`;
}

/** 这一轮给模型看哪一版答案：有画面版就用画面版，否则只看字幕那版拆掉末尾的卡片文字版（`splitAnswer`，片 c） */
function answerOf(row: HistoryRow): { text: string; visual: boolean } | null {
  const visual = row.ai_answer_visual?.trim();
  if (visual) return { text: visual, visual: true };
  if (!row.ai_answer?.trim()) return null;
  const body = splitAnswer(row.ai_answer, readRefs(row.refs)).body.trim();
  return body ? { text: body, visual: false } : null;
}

/**
 * 挑出要交给模型的那几轮。
 * `recent`：这一轮之前最近几轮（路由按 `created_at` 倒序取的，这里不信它的顺序）；`parent`：母问题那一轮（可能也在 `recent` 里）。
 * 没问题或没答案的行（只记下这一刻的点、没答完的问）不算一轮。返回按提问先后，最早的在前。
 */
export function pastTurns(recent: readonly HistoryRow[], parent: HistoryRow | null): PastTurn[] {
  const at = (r: HistoryRow) => Date.parse(r.created_at) || 0;
  // 先认出哪些行算「一轮」，再挑最近三轮 —— 反过来的话，一个空点会占掉三个名额里的一个
  const usable = (row: HistoryRow) => {
    const question = row.question?.trim();
    const got = question ? answerOf(row) : null;
    return question && got ? { row, question, got } : null;
  };
  const latest = recent
    .map(usable)
    .filter((u) => u !== null)
    .sort((a, b) => at(b.row) - at(a.row))
    .slice(0, RECENT_TURNS);
  // 母问题那一轮常常就在最近三轮里 —— 按 id 去重
  const byId = new Map(latest.map((u) => [u.row.id, u]));
  const mother = parent ? usable(parent) : null;
  if (mother) byId.set(mother.row.id, mother);

  const kept = [...byId.values()].sort((a, b) => at(a.row) - at(b.row));
  return kept.map(({ row, question, got }, i) => ({
    tS: Math.max(0, Math.floor(Number(row.t_s) || 0)),
    question,
    answer: clipAnswer(got.text, i === kept.length - 1 ? LATEST_ANSWER_CAP : ANSWER_CAP),
    visual: got.visual,
    parent: row.id === parent?.id,
  }));
}

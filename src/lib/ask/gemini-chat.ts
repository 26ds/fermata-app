import { explainGeminiError } from "@/lib/transcript/gemini-youtube";
import { mmss } from "@/lib/time";
import type { TranscriptSegment } from "@/lib/types";
import { AskError, backgroundText, clientFor, windowText } from "./gemini-ask";

// M3 Phase-2 长问答沉浸聊天引擎。
//
// 和短问答（gemini-ask）的区别：
//   ① 多轮 —— 本次会话的实时几轮走 Gemini 的 contents（user/model 交替）；
//   ② 跨会话记忆 —— 往期重点走 systemInstruction 里的 summary（不是逐字回放，省又准）；
//   ③ 接地窗口跟着**当前播放头**走，不锚死某个打断点。
// 仍是通用问答，不套教学法（苏格拉底式是 M4，教学法唯一来源 SKILL.md）。

const MODEL = "gemini-2.5-flash";
const ANSWER_TIMEOUT_MS = 60_000;
const COMPACT_TIMEOUT_MS = 45_000;
const ANSWER_MAX_TOKENS = 2_048;
const COMPACT_MAX_TOKENS = 1_024;

/** 沉浸聊天的当前播放头窗口，比短问答略宽 —— 聊的是"我正看的这一段"，不是精确某一秒 */
const WINDOW_BEFORE_S = 30;
const WINDOW_AFTER_S = 5;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  at_s?: number;
}

export interface AskChatContext {
  question: string;
  segments: TranscriptSegment[];
  /** 当前播放头（秒）—— 窗口 = [atS−30, atS+5] */
  atS: number;
  title: string | null;
  /** 往期会话的重点摘要（compact 出来的），可空 */
  priorSummary: string | null;
  /** 本次会话到目前为止的逐轮（不含正在问的这句） */
  liveTurns: ChatTurn[];
  onChunk: (text: string) => void | Promise<void>;
}

function groundingInstruction(ctx: AskChatContext): string {
  const where = ctx.title ? `《${ctx.title}》` : "这段内容";
  const focus = windowText(ctx.segments, ctx.atS - WINDOW_BEFORE_S, ctx.atS + WINDOW_AFTER_S);
  const background = backgroundText(ctx.segments);
  const parts = [
    `你是学习助手，正陪用户看 ${where}、边看边聊。直接、简洁地接着对话回答，扣住他现在看的这段和你们聊过的；别跑题、别编内容里没有的、别反问让他先猜。用他的语言。`,
  ];
  if (ctx.priorSummary?.trim()) {
    parts.push(`\n【这个用户之前在这条视频上聊过的重点（尤其他没搞懂的）】\n${ctx.priorSummary.trim()}`);
  }
  parts.push(`\n【他现在看到的（约 ${mmss(ctx.atS)}）】\n${focus || "（这一刻附近没有字幕）"}`);
  parts.push(`\n【全文背景（参考，别硬塞）】\n${background || "（没有更多字幕）"}`);
  return parts.join("\n");
}

/** 流式多轮问答。逐块 onChunk 吐出，收完返回完整答案（给调用方 append 落库）。 */
export async function askChat(ctx: AskChatContext): Promise<string> {
  const ai = clientFor();
  const contents = [
    ...ctx.liveTurns.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.text }],
    })),
    { role: "user", parts: [{ text: ctx.question }] },
  ];

  let answer = "";
  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: {
        systemInstruction: groundingInstruction(ctx),
        temperature: 0.4,
        maxOutputTokens: ANSWER_MAX_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
      },
    });
    for await (const chunk of stream) {
      const piece = chunk.text;
      if (piece) {
        answer += piece;
        await ctx.onChunk(piece);
      }
    }
  } catch (e) {
    throw new AskError(explainGeminiError(e instanceof Error ? e.message : String(e)));
  }

  const trimmed = answer.trim();
  if (!trimmed) throw new AskError("这次没答出内容，换个问法再问一次。");
  return trimmed;
}

export interface CompactChatContext {
  /** 已有的旧备忘（可空） */
  priorSummary: string | null;
  /** 这次要折进备忘的新逐轮 */
  turns: ChatTurn[];
  title: string | null;
}

const COMPACT_PROMPT = `把下面「用户看视频时和 AI 的对话」浓缩成一份学习备忘，之后接着聊时给 AI 当背景。
只保留重点，**以用户问了什么、以及他明显没搞懂/混淆/反复追问的地方为主**；AI 的回答只在为了说清用户的卡点时才带一句。
用第三人称、用户的语言，尽量短。若已有旧备忘，把新内容并进去、别丢旧的关键点。
只输出更新后的备忘正文，别加标题、别加客套。`;

/**
 * 退出（或下次进入兜底）时把新逐轮折进 summary。非流式。
 * 没有新逐轮就原样返回旧备忘（省一次调用）。
 */
export async function compactChat(ctx: CompactChatContext): Promise<string> {
  if (ctx.turns.length === 0) return ctx.priorSummary?.trim() ?? "";

  const ai = clientFor();
  const dialogue = ctx.turns
    .map((t) => `${t.role === "assistant" ? "AI" : "用户"}：${t.text}`)
    .join("\n");
  const body = [
    ctx.title ? `视频：《${ctx.title}》` : null,
    ctx.priorSummary?.trim() ? `【旧备忘】\n${ctx.priorSummary.trim()}` : null,
    `【新对话】\n${dialogue}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: body }] }],
      config: {
        systemInstruction: COMPACT_PROMPT,
        temperature: 0.2,
        maxOutputTokens: COMPACT_MAX_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: AbortSignal.timeout(COMPACT_TIMEOUT_MS),
      },
    });
    const out = (res.text ?? "").trim();
    // 万一模型没吐东西，别把旧备忘冲没了
    return out || (ctx.priorSummary?.trim() ?? "");
  } catch (e) {
    throw new AskError(explainGeminiError(e instanceof Error ? e.message : String(e)));
  }
}

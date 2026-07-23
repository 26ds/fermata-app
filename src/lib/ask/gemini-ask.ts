import { GoogleGenAI } from "@google/genai";
import { explainGeminiError } from "@/lib/transcript/gemini-youtube";
import { mmss } from "@/lib/time";
import type { TranscriptSegment } from "@/lib/types";

// M3 打断问答 —— 用户卡在某一刻打字问一句，Gemini Flash 扣着当前字幕直接答。
//
// 这是**通用问答**，不套教学法：不反问、不「你先猜猜看」。苏格拉底式那套是 M4 学习模式，
// 教学法唯一来源是 SKILL.md，这里刻意不碰（AGENTS.md：别在代码里另写教学逻辑）。
//
// 接地范围 = 窗口 [t−15, t+3]（他刚听到的那几句，焦点）+ 全文（背景，兜住指代）。
// —— WORKORDER §「打断问答（Gemini Flash，窗口+全文上下文）」。

const MODEL = "gemini-2.5-flash";

/** 单次问答最长等这么久 */
const ANSWER_TIMEOUT_MS = 60_000;

/** 答案够用就行，别让它写论文；也压住 token 成本 */
const MAX_OUTPUT_TOKENS = 2_048;

/** 全文只作背景，超这么多字符就掐尾 —— Flash 能吃百万 token，但没必要为一次问答烧那么多 */
const FULL_TRANSCRIPT_CHAR_CAP = 24_000;

export class AskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskError";
  }
}

export interface AskContext {
  question: string;
  segments: TranscriptSegment[];
  /** 打断点窗口 [start, end]，落库时按 D5 定死的 t−15 / t+3 */
  windowStartS: number;
  windowEndS: number;
  /** 卡在第几秒（只用来告诉模型「他卡在 MM:SS」） */
  tS: number;
  title: string | null;
  /** 逐块回调：流式把答案吐给上层 */
  onChunk: (text: string) => void | Promise<void>;
}

export function clientFor(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AskError("服务器还没配置 GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
}

/** 窗口 [start,end] 内（有重叠即算）的逐句原文 —— 用户「刚听到的那几句」，问答的焦点。沉浸聊天也复用 */
export function windowText(segments: TranscriptSegment[], startS: number, endS: number): string {
  return segments
    .filter((s) => s.start <= endS && s.end >= startS)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

/** 全文作背景，超预算掐尾。沉浸聊天也复用 */
export function backgroundText(segments: TranscriptSegment[]): string {
  const all = segments
    .map((s) => s.text)
    .join(" ")
    .trim();
  if (all.length <= FULL_TRANSCRIPT_CHAR_CAP) return all;
  return `${all.slice(0, FULL_TRANSCRIPT_CHAR_CAP)}…（全文较长，仅取前段作背景）`;
}

function buildPrompt(ctx: AskContext): string {
  const focus = windowText(ctx.segments, ctx.windowStartS, ctx.windowEndS);
  const background = backgroundText(ctx.segments);
  const where = ctx.title ? `《${ctx.title}》` : "这段内容";
  return [
    `你是学习助手。用户正在看 ${where}，在 ${mmss(ctx.tS)} 处卡住了，想问你一句。`,
    "",
    "【他刚听到的（回答的焦点，扣住这里）】",
    focus || "（这一刻附近没有字幕）",
    "",
    "【全文背景（仅供参考，别硬塞）】",
    background || "（没有更多字幕）",
    "",
    `【他的问题】\n${ctx.question}`,
    "",
    "要求：直接、简洁地回答，扣住他卡住的那段；别跑题、别编内容里没有的、别反问让他先猜。用他提问的语言回答。",
  ].join("\n");
}

/**
 * 流式问答。逐块 `onChunk` 吐出，全部收完返回完整答案（给调用方落库用）。
 * 出错统一包成 AskError，说人话（额度/限流/私享视频等复用 explainGeminiError）。
 */
export async function askQuestion(ctx: AskContext): Promise<string> {
  const ai = clientFor();
  const prompt = buildPrompt(ctx);

  let answer = "";
  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // 通用问答不需要长链推理，思考预算砍掉省时省钱（与转写/翻译同款）
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

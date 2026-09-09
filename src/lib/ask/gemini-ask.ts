import "server-only";
import { GoogleGenAI } from "@google/genai";
import { explainGeminiError } from "@/lib/transcript/gemini-youtube";
import { langNameEn, normalizeLang } from "@/lib/lang";
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
  /** D42 修订③：用户母语 —— 现在只是**兜底**（问句看不出语言时才用）。空 = 还不知道 */
  nativeLang?: string | null;
  /**
   * D56「说短一点」：**拿同一份 context 重答一版更短的**。
   *
   * 它是 M3.15 片 b 那三颗按钮里的第三颗。三件事必须一起成立才算做对：
   * ① 原答案**不覆盖**（调用方负责：`brief` 这一趟不写库）；
   * ② 两版**可来回切**（前端把短版留在内存里，切回去不再花钱）；
   * ③ **不点就一分钱不花**（D44：花钱的动作只由人点）。
   */
  brief?: boolean;
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

/**
 * **答案语言 = 他这次提问所用的语言。**（D42 修订③，2026-09-09 创始人拍板）
 *
 * ⚠️ 这是**掉头**，不是补丁 —— D42 原来（⑶）特意把答案语言钉死在母语上，
 * 理由是：他用英文问一句 "what does XX mean"，可能只是懒得切输入法，
 * 母语是我们知道的事实，没理由让模型猜。**那条理由现在被更强的场景压过去了**：
 * 产品要给外国人用，对方用英文问就必须英文答，不能因为设置里母语还写着中文
 * 就整段中文回过去 —— 那一刻「母语」根本不是他的母语。
 *
 * 母语没有作废，**退居兜底**：问句短到看不出语言时（只有一个术语、一串符号、
 * 一个链接）才用它。这样「懒得切输入法」那个老场景里最脆弱的一类（单个英文词）
 * 依然走母语，而整句英文提问走英文。
 *
 * 🚩 **界面语言（`uiLang`）一个字都不许进这里**，D42 红线原封不动。
 * 中/EN 那颗按钮换的是界面，不是 AI 的嘴。快捷问按钮是唯一的间接影响：
 * 它发出去的那句话本身就是界面语言写的，所以答案跟着它走 —— 这是对的，
 * 因为那句话确实是"用户问出去的问题"。
 */
export function answerLanguageRule(nativeLang: string | null | undefined): string {
  const code = normalizeLang(nativeLang);
  const fallback = code
    ? `问句短到看不出是什么语言时（只有一个词、一串符号、一个链接），用${langNameEn(code)}（${code}）。`
    : "";
  return (
    "用**他这次提问所用的那种语言**回答：他用中文问就整段中文，用英文问就整段英文，" +
    "其他语言同理；多轮对话看他最新那条。判断只看问句本身主要用的是哪种语言 —— " +
    `问句里引用的外语词、以及内容原文是什么语言，都不作数。${fallback}`
  );
}

/**
 * 备忘（compact）用的语言规则 —— **和上面那条故意不同**。
 *
 * 备忘不是"回答"，是塞回下一轮 systemInstruction 的内部笔记，用户看不到。
 * 它必须**跨轮稳定**：跟着"最新那条问句"走的话，用户中英夹着问几句，
 * 备忘就会一段中文一段英文地长下去。所以这里保留 D42 原来的做法 —— 钉死母语。
 */
export function memoLanguageRule(nativeLang: string | null | undefined): string {
  const code = normalizeLang(nativeLang);
  if (!code) return "";
  return `备忘正文用${langNameEn(code)}（${code}）写。`;
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
    // ── 答案的形状是**有顺序的**（计划 §B.5，创始人第一轮的原话）──
    //
    // 「先简要解释相关概念 → 再说视频前后哪里还讲到这件事并标出时间」。
    // 不是把两件事揉成一段：**先给他一个当场能用的答案，再给他「后面还有」**。
    // 揉在一起的写法在真机上是这样的：他想知道这个词什么意思，
    // 读到第三行还在讲"这个视频 18:20 也提到过"。
    //
    // ⚠️ 第二段现在**只是文字**：时间戳还不可点、也还没去字幕里核对。
    // 核对与吸附（D64）+ 概述卡是**片 c** 的活。所以这里先用提示词兜一道 ——
    // 「核不准就别提」——**它是提示词层面的约束，不是校验**，别把它当成 D64 已经落地了。
    "要求：",
    "① 先直接、简洁地回答他问的那件事，扣住他卡住的那几句；" +
      "别跑题、别编内容里没有的、别反问让他先猜。",
    "② 如果这条内容的**别处**确实还讲到这件事，答完之后另起一段补一句" +
      "「后面 MM:SS 还会讲到……」（在他提问那一刻之前的就说「前面」），" +
      "并把那一秒的**字幕原句**一起引出来。" +
      "**只在字幕里真找得到的时候才提；不确定就整段不写** —— 宁可只答第一段，" +
      "也不要给一个对不上的时间。",
    ctx.brief
      ? "③ 这一版**要短**：只留最要紧的那一层意思，三句以内；不铺垫、不复述他的问题、不列点。" +
        "第②段这一版**不写**。"
      : "",
    answerLanguageRule(ctx.nativeLang),
  ]
    .filter(Boolean)
    .join("\n");
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

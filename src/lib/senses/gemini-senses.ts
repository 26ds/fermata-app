import "server-only";
import { Type } from "@google/genai";
import { langNameEn, type StudyMode } from "@/lib/lang";
import { PhraseError, clientFor, modeBrief } from "@/lib/phrases/gemini-phrases";
import { MAX_SENSES, readSenses, type Sense } from "./types";

// M3.11 悬浮词卡 —— 查一个词：**这一句里是什么意思** + **另外三个最常用的意思**（D42 + D44）。
//
// 创始人 2026-08-04 点名先看开源词典，实测过了，走不通（理由全文在 plans/M3.11-plan.md）：
// 免费词典的释义**只有英文**（`because`/`run`/`settle` 逐个查，中文日文译文一条都没有），
// 而 Fermata 是任意母语 × 任意内容语言；词典还查不了 "hang in there" 这种词组，
// 更给不了「在这一句里是哪个意思」—— 那要看上下文。
//
// **省钱的关键在调用方**：义项那半边是全站共享缓存（`word_senses`），
// 某个词在某门母语里全世界只算一次。这里只管"缓存没有的时候怎么算出来"。

const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 20_000;

/**
 * 让模型直接吐 JSON，**不再靠提示词去求它守格式**。
 * M3.7 那次血的教训是"模型偶尔换个分隔符，整批解析成零，而症状和'本来就没东西'一模一样"；
 * `responseSchema` 是 API 层强制的，不是提示词层的祈求 —— 两回事。
 */
const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    contextPos: { type: Type.STRING },
    contextGloss: { type: Type.STRING },
    senses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { pos: { type: Type.STRING }, gloss: { type: Type.STRING } },
        required: ["pos", "gloss"],
      },
    },
  },
  required: ["contextPos", "contextGloss", "senses"],
};

export interface LookupInput {
  term: string;
  /** 它出现的那句原话。没有上下文，一个多义词只能瞎猜 */
  context: string;
  mode: StudyMode;
  contentLang: string;
  nativeLang: string;
  targetLang: string;
  /** 只缺义项（语境意思库里已经有了）→ 提示词就不必再写一遍那一半 */
  wantContext: boolean;
  wantSenses: boolean;
}

export interface LookupResult {
  context: Sense | null;
  senses: Sense[];
}

/**
 * 查一个词。**只由人的动作触发**（悬浮 / 长按 / 点重试），
 * 代码永远不许自己重来（D44：花钱的动作只能人点）。
 */
export async function lookupTerm(input: LookupInput): Promise<LookupResult> {
  if (!input.wantContext && !input.wantSenses) return { context: null, senses: [] };

  const ai = clientFor();
  const contentName = langNameEn(input.contentLang) || "the language of the transcript";
  const nativeName = langNameEn(input.nativeLang) || "the language of the transcript";
  const targetName = langNameEn(input.targetLang);

  const prompt = `A learner is looking up an expression they met in a transcript. Fill in a dictionary card for them.

Content language: ${contentName}
Learner's native language: ${nativeName}
Language they are learning: ${targetName || "(none — they only want to understand the content)"}

THE EXPRESSION
${input.term}

THE SENTENCE IT CAME FROM
${input.context || "(not available)"}

WHAT MATTERS TO THIS LEARNER
${modeBrief(input.mode)}

FILL IN
- contextPos: the part of speech the expression has IN THIS SENTENCE.
- contextGloss: what it means IN THIS SENTENCE. Not every meaning it could ever have — this one.
- senses: up to ${MAX_SENSES} of its OTHER most common meanings, most frequent first, each with its own part of speech.
  These are the general dictionary senses, independent of the sentence above.
  **Do not repeat the contextual meaning here.**
  If the expression is a fixed phrase or has no other common meaning, return an EMPTY array — do not invent rare senses to fill the quota.

RULES
1. **Write every field in ${nativeName}** — including the parts of speech (a Chinese speaker reads 「连词」, an English speaker reads "conjunction"). Never leave them in ${contentName} unless ${nativeName} is ${contentName}.
2. Keep each gloss to one short clause: at most 20 characters if ${nativeName} is dense (Chinese/Japanese), at most 12 words otherwise.
3. Do not restate the expression itself, do not quote it back, no labels like "meaning:".`;

  let res;
  try {
    res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 700,
        // 查词不需要长链推理（与转写/翻译/问答/标词同款）
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new PhraseError("查这个词超时了（20 秒没回来）。");
    }
    throw e;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.text ?? "");
  } catch {
    // 开了 responseSchema 还解析不出来，说明这一趟根本没拿到东西（被截断/被拦）。
    // **绝不当成"这个词没有义项"** —— 那会把一次失败静默地写成一条空缓存，
    // 从此这个词永远查不出东西来（D44 最恨的那种）
    throw new PhraseError("模型这次没给出可用的结果。");
  }

  const pos = typeof parsed.contextPos === "string" ? parsed.contextPos.trim() : "";
  const gloss = typeof parsed.contextGloss === "string" ? parsed.contextGloss.trim() : "";

  return {
    context: input.wantContext && gloss ? { pos, gloss } : null,
    senses: input.wantSenses ? readSenses(parsed.senses) : [],
  };
}

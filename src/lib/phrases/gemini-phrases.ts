import { GoogleGenAI } from "@google/genai";
import { langNameEn, normalizeLang, type StudyMode } from "@/lib/lang";
import { explainGeminiError } from "@/lib/transcript/gemini-youtube";
import type { TranscriptSegment } from "@/lib/types";
import type { PhraseItem } from "./types";

// M3.7 词库 —— **整片扫一次**，把值得收藏的表达标出来（D40 + D42）。
//
// 为什么是整片扫一次、而不是每次暂停实时扫那两秒（创始人 2026-07-30 选定）：
//   ① 暂停那一刻最不想等（实时要约 1 秒）；
//   ② 同一处停两次要付两次钱；
//   ③ **值得收的表达不会只长在你暂停的地方** —— 往回翻字幕时会是一片空白。
//
// **标什么由三个语言的关系决定**（D42），不是"给中国人标英文习语"这种硬编码：
//   学语言 → 地道表达 / 搭配 / 口语说法；学知识 → 术语 / 概念 / 行话；混合 → 两者、偏术语。

const MODEL = "gemini-2.5-flash";

/** 一批多少段字幕。一次性丢 600 段进去，模型数行号必错 —— 分批是为了对得准，不是为了快 */
const BATCH_SEGMENTS = 100;
const BATCH_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 4_096;

/** 检测内容语言时喂多少字符就够了 */
const DETECT_CHARS = 1_500;
const DETECT_TIMEOUT_MS = 20_000;

export class PhraseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhraseError";
  }
}

function clientFor(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new PhraseError("服务器还没配置 GEMINI_API_KEY，词库扫描暂时不可用。");
  return new GoogleGenAI({ apiKey });
}

/**
 * 这条内容是什么语言 —— 只在库里还空着时才跑（一支内容一辈子一次，约 500 token）。
 *
 * 为什么需要它：播客走转写，模型顺手就报了语言；但 **YouTube 粘贴字幕那条路
 * 一个字都没经过模型**，`content_lang` 会一直空着 —— 而空着就没法判断"这是不是他母语"，
 * 整个 D42 的模式判定就落不了地。
 */
export async function detectContentLang(segments: TranscriptSegment[]): Promise<string> {
  const sample = segments
    .map((s) => s.text)
    .join(" ")
    .slice(0, DETECT_CHARS)
    .trim();
  if (!sample) return "";

  const ai = clientFor();
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `What language is this text in? Answer with ONLY a BCP-47 language code (like en, ja, zh-Hans, es). No explanation.\n\n${sample}`,
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 16,
        thinkingConfig: { thinkingBudget: 0 },
        abortSignal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
      },
    });
    return normalizeLang((res.text ?? "").trim().split(/\s+/)[0] ?? "");
  } catch {
    // 检测不出来不是致命的：模式退回"混合"，两种都标一点。别为这个把扫描整条毙掉
    return "";
  }
}

/** 每种模式挑什么 —— **这段文字是 D42 落地的关键**，不许出现具体语言名 */
function modeBrief(mode: StudyMode): string {
  if (mode === "language") {
    return [
      "Pick IDIOMATIC, COLLOQUIAL expressions — the phrasings a native speaker actually uses but a textbook would not teach:",
      "collocations, phrasal verbs, idioms, slang, discourse markers, fixed expressions.",
      "Do NOT pick: ordinary single words the learner surely knows, proper nouns, numbers, technical jargon.",
    ].join(" ");
  }
  if (mode === "knowledge") {
    return [
      "Pick TERMS and CONCEPTS — the domain-specific vocabulary, jargon and named ideas that carry the meaning of this material.",
      "Do NOT pick: ordinary everyday words, proper nouns used only in passing, idioms or slang.",
    ].join(" ");
  }
  return [
    "Pick BOTH domain terms/concepts AND idiomatic expressions, but LEAN TOWARD terms and concepts.",
    "Do NOT pick: ordinary everyday words, proper nouns, numbers.",
  ].join(" ");
}

/**
 * `<行号><分隔><词组><分隔><解释>`。
 *
 * **分隔符要认得宽**（M3.7 真机第一轮的教训）：只认 `\t` 时，模型偶尔改用竖线、
 * 破折号或几个空格，整批就一条都解析不出来 —— 而症状是"扫了但什么都没标出来"，
 * 从外面看和"这段确实没词可标"一模一样，根本查不出来。宁可认宽一点。
 */
const SEPARATOR = /\t+|\s*\|\s*|\s+[—–]\s+|\s{2,}/;

/** 行首的序号/项目符号：`3.` `- 3:` `* 3 ` 都要剥掉，只留数字 */
const LEADING = /^\s*[-*•]?\s*(\d+)\s*[.:、)\]]?\s*/;

function parsePicks(raw: string, valid: Set<number>): Map<number, { text: string; gloss: string }> {
  const out = new Map<number, { text: string; gloss: string }>();
  // 模型有时会把整段裹进 ``` 代码块里
  const body = raw.replace(/^\s*```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = LEADING.exec(line);
    if (!head) continue;
    const i = Number(head[1]);
    if (!valid.has(i) || out.has(i)) continue; // 每行封顶 1 个（D40）：同一行只留第一条
    const rest = line.slice(head[0].length);
    const parts = rest.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue; // 只有词组没有解释：宁可丢，不给一条没解释的词
    const text = parts[0];
    const gloss = parts.slice(1).join(" ");
    if (text && gloss) out.set(i, { text, gloss });
  }
  return out;
}

export interface ScanContext {
  segments: TranscriptSegment[];
  /** 从第几段开始扫（断点续扫：上次预算用完停在哪儿） */
  from: number;
  mode: StudyMode;
  contentLang: string;
  nativeLang: string;
  targetLang: string;
  /** 还剩多少毫秒预算。到点就干净收尾，把扫到的存下来，下次接着扫 */
  remainingMs(): number;
}

async function scanBatch(
  ai: GoogleGenAI,
  ctx: ScanContext,
  offset: number,
  batch: TranscriptSegment[],
): Promise<PhraseItem[]> {
  const numbered = batch.map((s, k) => `${offset + k}\t${s.text}`).join("\n");
  const contentName = langNameEn(ctx.contentLang) || "the language of the transcript";
  const nativeName = langNameEn(ctx.nativeLang) || "the language of the transcript";
  const targetName = langNameEn(ctx.targetLang);

  const prompt = `You help a learner collect expressions worth saving from a transcript.

Content language: ${contentName}
Learner's native language: ${nativeName}
Language they are learning: ${targetName || "(none — they only want to understand the content)"}

WHAT TO PICK
${modeBrief(ctx.mode)}

RULES
1. At most ONE pick per numbered line. Aim for roughly one pick every 4 to 8 lines — enough that the reader always has something to collect, few enough that it stays worth collecting. Only return nothing at all if this batch is genuinely filler (silence, names, numbers).
2. The picked phrase MUST be copied VERBATIM from that line (same spelling, same case, same words, contiguous). Anything not found verbatim in its line is discarded.
3. Write the explanation in ${nativeName}. One short clause, at most 20 characters if that language is dense (Chinese/Japanese), at most 12 words otherwise. No restating the phrase.
4. Output ONE LINE per pick, exactly: <number><TAB><phrase><TAB><explanation>
   Use a real TAB between the three fields. Output nothing else — no headers, no markdown, no commentary. Lines with no pick are simply omitted.

EXAMPLE (format only — the fields are separated by a real TAB)
12${"\t"}<phrase copied verbatim from line 12>${"\t"}<short explanation written in ${nativeName}>

TRANSCRIPT LINES
${numbered}`;

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // 挑词组不需要长链推理，思考预算砍掉（与转写/翻译/问答同款）
      thinkingConfig: { thinkingBudget: 0 },
      abortSignal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
    },
  });

  const valid = new Set(batch.map((_, k) => offset + k));
  const picks = parsePicks(res.text ?? "", valid);

  const items: PhraseItem[] = [];
  for (const [i, pick] of picks) {
    const seg = ctx.segments[i];
    if (!seg) continue;
    // **服务端自己 indexOf 定位**，绝不让模型数字符位置（它数不准）。
    // 找不到 = 模型改写过原文，这条直接丢 —— 高亮标错地方比不标糟得多。
    let start = seg.text.indexOf(pick.text);
    if (start < 0) start = seg.text.toLowerCase().indexOf(pick.text.toLowerCase());
    if (start < 0) continue;
    items.push({ i, t: seg.start, start, text: seg.text.slice(start, start + pick.text.length), gloss: pick.gloss });
  }
  return items;
}

/**
 * 扫（一段区间的）字幕。**串行**分批 —— 一支一小时的内容约 6 批、十几秒，
 * 而且是在用户看视频的时候后台跑，没必要为并行去扛错误处理的复杂度。
 *
 * 预算到点就停，把扫到的返回、并如实报 `scannedThrough`，下次从那儿接着扫。
 */
export async function scanPhrases(
  ctx: ScanContext,
): Promise<{ items: PhraseItem[]; scannedThrough: number }> {
  const ai = clientFor();
  const items: PhraseItem[] = [];
  let cursor = Math.max(0, ctx.from);

  try {
    while (cursor < ctx.segments.length) {
      if (ctx.remainingMs() < BATCH_TIMEOUT_MS) break; // 剩下的时间不够打一枪，干净收尾
      const batch = ctx.segments.slice(cursor, cursor + BATCH_SEGMENTS);
      if (batch.length === 0) break;
      items.push(...(await scanBatch(ai, ctx, cursor, batch)));
      cursor += batch.length;
    }
  } catch (e) {
    // 已经扫到的照样有用（下次从 cursor 接着来）；一批都没扫成才算真失败
    if (items.length === 0) {
      throw new PhraseError(explainGeminiError(e instanceof Error ? e.message : String(e)));
    }
  }

  return { items, scannedThrough: cursor };
}

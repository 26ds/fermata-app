import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { TranscriptSegment } from "@/lib/types";
import { explainGeminiError } from "@/lib/transcript/gemini-youtube";
import { langName } from "./langs";

// M2.9 双语字幕 —— 把一条已经缓存好的字幕，整体翻成目标语言。
//
// **唯一的真风险是「行对齐」**：把整段字幕批量丢给模型，它可能把两句合并、一句拆两句、
// 漏一句，译文就贴到别的原文下面，整屏全错。所以每一句都带**全局编号**发出去，回来
// 严格按编号回填，缺号只补那一批、不重翻全部（跟 2a「模型输出格式是概率不是契约」同源）。
// 这套办法在生产探针上验过：中/日/韩三语、单批与两批、满屏「对。」「嗯。」这种最易被合并的
// 短句，全部零缺号（见 plans/M2.9-log.md 的探针结论）。
//
// **服务端专用**（D24）：靠首行 `import "server-only";` 把关 —— 客户端一旦 import
// 到这里，**构建当场失败**。原先写的 `grep -rl "gemini\|translate\|@google/genai"
// .next/static/chunks/` 已于 2026-08-07 作废：`translate` 会匹配 Tailwind 的
// `translate-x-[23px]` 和客户端合法的 `fetch("/api/translate")`，`@google/genai`
// 会匹配 /lab/live 那个合法的 Live SDK —— 它从来就没绿过。详见 D24。

const MODEL = "gemini-2.5-flash";

/** 一批多少句。探针里 50 句稳过；60 给一点余量又不至于让单次输出过长 */
const BATCH = 60;

/** 同时翻几批。各批互不相干，本来就该并行 —— 一小时字幕（约 12 批）三路并行约 20 秒翻完 */
const CONCURRENCY = 3;

/** 单批最长等这么久，超了当这一批失败 */
const BATCH_TIMEOUT_MS = 60_000;

/** 一批 60 句译文，8k token 足够（探针 50 句进+出才 1.3k） */
const MAX_OUTPUT_TOKENS = 8192;

/** 与字幕**按下标对齐**的一条译文 */
export interface TranslatedSegment {
  i: number;
  start: number;
  text: string;
}

export interface TranslateProgress {
  translations: TranslatedSegment[];
  done: number;
  total: number;
}

export interface TranslateResult {
  translations: TranslatedSegment[];
  complete: boolean;
  /** 没翻完的原因（人话）。null = 正常收尾（预算到点也算正常，不填原因） */
  note?: string | null;
}

/** 该停下并告诉用户的错误（额度/密钥/没字幕）——不该被静默吞掉 */
export class TranslateError extends Error {}

const LINE = /^\s*(\d+)[\t 　.:)、．]+(.+)$/;

/** 按行首编号回填。只认落在 valid 里的编号（挡住模型偶尔吐的野号） */
function parseNumbered(raw: string, valid: Set<number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of raw.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const i = Number(m[1]);
    const text = m[2].trim();
    if (text && valid.has(i) && !out.has(i)) out.set(i, text);
  }
  return out;
}

function clientFor(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TranslateError("服务器还没配置 GEMINI_API_KEY，翻译暂时不可用。");
  return new GoogleGenAI({ apiKey });
}

async function callModel(
  ai: GoogleGenAI,
  items: TranslatedSegment[],
  name: string,
): Promise<Map<number, string>> {
  const numbered = items.map((it) => `${it.i}\t${it.text}`).join("\n");
  const prompt = `You are a subtitle translator. Translate each numbered source line into ${name}.
Output EXACTLY one line per input line, in this format: <number><TAB><translation>
Keep the SAME numbers. Do NOT merge, split, reorder, or omit any line. No commentary, no markdown.
Preserve proper nouns. If a line is only punctuation or an interjection, still translate it naturally.

Source lines:
${numbered}`;

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // 翻译不需要推理，思考预算全砍掉 —— 省时间也省 token
      thinkingConfig: { thinkingBudget: 0 },
      abortSignal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
    },
  });
  return parseNumbered(res.text ?? "", new Set(items.map((it) => it.i)));
}

/**
 * 翻一批。缺号就**只补缺的那几句**再打一枪（探针里零缺号，这是安全网）。
 * 补完还缺的，留空 —— 客户端那几行就只显示原文，绝不因为漏一两句就整条翻译失败。
 */
async function translateBatch(
  ai: GoogleGenAI,
  batch: TranslatedSegment[],
  name: string,
): Promise<TranslatedSegment[]> {
  const got = await callModel(ai, batch, name);
  const missing = batch.filter((it) => !got.has(it.i));
  if (missing.length > 0) {
    const retry = await callModel(ai, missing, name);
    for (const [i, t] of retry) got.set(i, t);
  }
  const out: TranslatedSegment[] = [];
  for (const it of batch) {
    const text = got.get(it.i);
    if (text) out.push({ i: it.i, start: it.start, text });
  }
  return out;
}

export interface TranslateContext {
  segments: TranscriptSegment[];
  targetLang: string;
  /** 已翻好的（断点续传）—— 按 i 去重，只翻没翻过的 */
  existing?: TranslatedSegment[];
  onPartial(progress: TranslateProgress): Promise<void>;
  remainingMs(): number;
}

/**
 * 把整条字幕翻成 targetLang。并行分批、按编号回填、预算到点干净收尾。
 * 返回的 translations 与字幕**按下标对齐**（每项带 i / start / text）。
 */
export async function translateSegments({
  segments,
  targetLang,
  existing = [],
  onPartial,
  remainingMs,
}: TranslateContext): Promise<TranslateResult> {
  const name = langName(targetLang);
  const all: TranslatedSegment[] = segments.map((s, i) => ({ i, start: s.start, text: s.text }));
  const total = all.length;
  if (total === 0) throw new TranslateError("这条内容还没有字幕，先生成字幕再翻译。");

  const have = new Set(existing.map((e) => e.i));
  const results: TranslatedSegment[] = existing.filter((e) => e.i < total);
  const todo = all.filter((x) => !have.has(x.i) && x.text.trim().length > 0);
  if (todo.length === 0) return { translations: results.sort((a, b) => a.i - b.i), complete: true };

  const ai = clientFor(); // 没配 GEMINI_API_KEY 就在这里抛 TranslateError，别等进了 worker

  // 切批（每批保留全局 i）
  const queue: TranslatedSegment[][] = [];
  for (let s = 0; s < todo.length; s += BATCH) queue.push(todo.slice(s, s + BATCH));

  let firstFailure: string | null = null;
  let stopReason: string | null = null;
  let stopped = false;

  const emit = async () => {
    await onPartial({
      translations: [...results].sort((a, b) => a.i - b.i),
      done: results.length,
      total,
    });
  };

  const worker = async () => {
    for (;;) {
      if (stopped || firstFailure) return;
      // 预算不够再翻一批就收手：已翻的都算数，剩下的下次接着来
      if (remainingMs() < 20_000) {
        stopped = true;
        return;
      }
      const batch = queue.shift();
      if (!batch) return;
      try {
        const got = await translateBatch(ai, batch, name);
        results.push(...got);
        await emit();
      } catch (e) {
        const why = explainGeminiError(e instanceof Error ? e.message : String(e));
        // 一句都还没翻出来就炸 = 直接失败并说清原因（额度/限流等）
        if (results.length === 0) {
          firstFailure = why;
          return;
        }
        // 已经翻了一部分 = 留着，停下并带出原因，让用户「继续翻译」
        stopReason = why;
        stopped = true;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));

  if (firstFailure) throw new TranslateError(firstFailure);

  results.sort((a, b) => a.i - b.i);
  return {
    translations: results,
    complete: queue.length === 0 && !stopped,
    note: stopReason,
  };
}

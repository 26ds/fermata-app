import "server-only";
import { GoogleGenAI } from "@google/genai";
import { normalizeLang } from "@/lib/lang";
import { dominantScript, langOfScript } from "@/lib/text-script";
import type { TranscriptSegment } from "@/lib/types";

// 「这条内容是什么语言」—— **先免费看正文，看不出来才花钱问模型。**
//
// 为什么需要它：播客走转写，Whisper 顺手就报了语言；但 **YouTube 那条路一个字都没经过
// 会报语言的模型**（`gemini-youtube` 就没这个输出，粘贴字幕更是连模型都不过），
// `content_lang` 会一直空着 —— 而空着的代价是实打实的：
//   ① D42 的模式判定（学语言还是学知识）落不了地；
//   ② `/api/translate` 判不出"原文就是你要的那门语言"，于是**掏钱把英语翻成英语**
//      （2026-08-08 创始人真机报的就是这个）。
//
// 这一份原来长在 `phrases/gemini-phrases.ts` 里。搬出来是因为它跟词库没关系，
// 而且长在那儿有个具体的坑：没配 key 时它抛的是「词库扫描暂时不可用」，
// 翻译那条路上撞见这句话没人看得懂。**这里的契约是永不抛异常** ——
// 判不出来就返回空串，调用方照旧走原来的路（多花一次钱，好过把该翻的判成不翻）。

const MODEL = "gemini-2.5-flash";

/** 喂多少字符就够判语言了 */
const DETECT_CHARS = 1_500;
const DETECT_TIMEOUT_MS = 20_000;

function sampleOf(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => s.text)
    .join(" ")
    .slice(0, DETECT_CHARS)
    .trim();
}

/**
 * 免费的那一半：只看正文用的是哪套文字。
 *
 * 假名 → 日语、谚文 → 韩语、泰文 → 泰语、天城文 → 印地语、汉字（且没假名）→ 中文，
 * 这几条几乎不会错。**拉丁/西里尔/阿拉伯字母一律返回空串** —— 那是好多门语言共用的，
 * 猜不得，得往下走那条花钱的路。
 */
export function detectLangByScript(segments: TranscriptSegment[]): string {
  const script = dominantScript(sampleOf(segments));
  const guess = script ? langOfScript(script) : null;
  return guess ? normalizeLang(guess) : "";
}

/**
 * 这条内容是什么语言。**先免费判，判不出来才问模型**（约 500 token，
 * 一支内容一辈子一次 —— 调用方拿到后要写回 `sources.content_lang`）。
 *
 * 判不出来返回空串，**从不抛异常**：没配 key、超时、模型胡说，都算判不出来。
 */
export async function detectContentLang(segments: TranscriptSegment[]): Promise<string> {
  const byScript = detectLangByScript(segments);
  if (byScript) return byScript;

  const sample = sampleOf(segments);
  if (!sample) return "";

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "";

  try {
    const ai = new GoogleGenAI({ apiKey });
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
    // 检测不出来不是致命的：词库那边模式退回"混合"，翻译那边照旧翻。别为这个把整件事毙掉
    return "";
  }
}

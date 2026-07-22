import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// 一次性探针（M2.9a，验完即删）：验「批量翻译字幕会不会把行对齐弄乱」。
// 这是双语字幕唯一的真风险 —— 模型把两句合并/一句拆两句/漏一句，译文就全错位。
// 内置一段真实感中文字幕（含大量短句「对。」「嗯。」，最容易被模型合并），
// 编号后整批丢给 Gemini，回来按行首编号回填，报告缺号/多号/对齐率/耗时/用量。
//
// curl 'https://fermata-eta.vercel.app/api/lab/tr-probe?lang=en'
//      'https://fermata-eta.vercel.app/api/lab/tr-probe?lang=ja&batch=25'

export const maxDuration = 120;

const MODEL = "gemini-2.5-flash";

const LANG_NAME: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  ru: "Russian",
  "zh-Hant": "Traditional Chinese",
};

// 一段模拟中文播客字幕：长短混排，故意塞了很多单字/双字短句 ——
// 「对。」「嗯。」「是吗？」这种是对齐最容易崩的地方（模型爱把它们并进上一句）。
const SAMPLE = [
  "今天我们聊聊《百年孤独》这本书。",
  "对。",
  "它的开头我觉得是文学史上最好的开头之一。",
  "「多年以后，面对行刑队，奥雷里亚诺·布恩迪亚上校将会回想起。」",
  "回想起什么？",
  "回想起他父亲带他去见识冰块的那个遥远的下午。",
  "嗯。",
  "这一句话里同时有三个时间。",
  "现在、未来、还有过去。",
  "对，这就是马尔克斯厉害的地方。",
  "他把整个家族七代人的命运，压缩在一个句子里。",
  "是吗？",
  "所以很多人第一次读会觉得晕。",
  "因为名字都很像。",
  "对对对，全都叫奥雷里亚诺或者何塞·阿尔卡蒂奥。",
  "哈哈哈。",
  "这其实是故意的。",
  "马尔克斯想说的是，这个家族在不断重复自己的命运。",
  "每一代人都逃不出那个循环。",
  "孤独的循环。",
  "对。",
  "那你觉得这本书的主题到底是什么？",
  "我觉得是孤独，但不是我们平常说的那种孤独。",
  "怎么说？",
  "是一种和历史、和时间对抗又必然失败的孤独。",
  "有点抽象。",
  "举个例子吧。",
  "上校打了三十二场内战，全都失败了。",
  "然后呢？",
  "然后他晚年就一直在做小金鱼，做好了熔掉，熔掉再做。",
  "反复地做。",
  "对，这个动作本身就是孤独的隐喻。",
  "明白了。",
  "还有那场下了四年多的大雨。",
  "四年？",
  "四年十一个月零两天。",
  "这么精确。",
  "马尔克斯的魔幻现实主义就在这儿。",
  "越是荒诞的事，他写得越精确。",
  "让你不得不信。",
  "对。",
  "最后整个马孔多被一阵风刮走了。",
  "连同这本书里写的一切。",
  "读完会有点怅然若失。",
  "嗯，那种感觉很难形容。",
  "所以我推荐大家一定要读原著。",
  "翻译版也行吗？",
  "范晔那个译本就非常好。",
  "好，那我们今天就聊到这里。",
  "下期见。",
];

function parseNumbered(raw: string, max: number): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of raw.split("\n")) {
    // 行首整数 + 一个或多个分隔符（Tab / 空格 / 冒号 / 点 / 顿号 / 括号），后面是译文
    const m = /^\s*(\d+)[\t 　.:)、．]+(.+)$/.exec(line);
    if (!m) continue;
    const i = Number(m[1]);
    const text = m[2].trim();
    if (text && i >= 0 && i < max && !out.has(i)) out.set(i, text);
  }
  return out;
}

async function translateBatch(
  ai: GoogleGenAI,
  lines: { i: number; text: string }[],
  langName: string,
): Promise<{ raw: string; usage: unknown }> {
  const numbered = lines.map((l) => `${l.i}\t${l.text}`).join("\n");
  const prompt = `You are a subtitle translator. Translate each numbered source line into ${langName}.
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
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  return { raw: res.text ?? "", usage: res.usageMetadata ?? null };
}

export async function GET(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "no GEMINI_API_KEY" }, { status: 500 });

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") ?? "en";
  const langName = LANG_NAME[lang] ?? lang;
  const batchSize = Number(url.searchParams.get("batch") ?? "0") || SAMPLE.length;

  const ai = new GoogleGenAI({ apiKey });
  const t0 = Date.now();

  // 切批（模拟真实分批 + 编号带全局偏移，验第二批 index 接得上）
  const all = SAMPLE.map((text, i) => ({ i, text }));
  const batches: { i: number; text: string }[][] = [];
  for (let s = 0; s < all.length; s += batchSize) batches.push(all.slice(s, s + batchSize));

  const merged = new Map<number, string>();
  const rawHeads: string[] = [];
  let usageTotal = 0;
  try {
    for (const batch of batches) {
      const { raw, usage } = await translateBatch(ai, batch, langName);
      const parsed = parseNumbered(raw, all.length);
      for (const [i, t] of parsed) if (!merged.has(i)) merged.set(i, t);
      rawHeads.push(raw.slice(0, 300));
      const u = usage as { totalTokenCount?: number } | null;
      if (u?.totalTokenCount) usageTotal += u.totalTokenCount;
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const missing: number[] = [];
  for (let i = 0; i < all.length; i++) if (!merged.has(i)) missing.push(i);

  // 抽几条看质量（含最容易崩的短句 1「对。」、6「嗯。」、40「对。」）
  const sample = [0, 1, 3, 6, 12, 20, 40, 47]
    .filter((i) => i < all.length)
    .map((i) => ({ i, src: all[i].text, tr: merged.get(i) ?? "❌缺" }));

  return NextResponse.json({
    ok: true,
    model: MODEL,
    lang,
    langName,
    batches: batches.length,
    batchSize,
    inCount: all.length,
    outCount: merged.size,
    aligned: merged.size === all.length && missing.length === 0,
    missing,
    elapsedMs: Date.now() - t0,
    tokensTotal: usageTotal,
    sample,
    rawHead: rawHeads[0],
  });
}

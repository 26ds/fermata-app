import { GoogleGenAI, MediaResolution } from "@google/genai";
import { NextResponse } from "next/server";

// ⚠️ 一次性探针（M2a-fix）—— 验完即删。
//
// 创始人真机反馈：17 分钟的视频等 1 分钟才见字幕，太慢。
// 提速有两条路，先量再改，不凭感觉调参：
//   ① 单次调用本身能不能更快（模型 / 帧率 / 媒体分辨率）
//   ② 首片切小一点，先让字幕上屏（10 分钟一片 → 2 分钟一片）
// 真正的大头其实是第三条（各片并行），那个不用测，是纯架构问题。

export const maxDuration = 300;

const PROMPT = `Transcribe the speech in this video verbatim.
Output one line per sentence, in exactly this format:
[MM:SS] text
Rules: no commentary, no summary, no markdown, no speaker labels, no blank lines.
Keep the original language — do not translate.
If there is no speech at all, output NO_SPEECH.`;

interface Cfg {
  label: string;
  model: string;
  fps: number;
  lowRes?: boolean;
  startS: number;
  endS: number;
}

const CONFIGS: Cfg[] = [
  { label: "现状 flash fps.2 / 10分钟", model: "gemini-2.5-flash", fps: 0.2, startS: 0, endS: 600 },
  { label: "flash fps.05 lowres / 10分钟", model: "gemini-2.5-flash", fps: 0.05, lowRes: true, startS: 0, endS: 600 },
  { label: "flash-lite fps.05 lowres / 10分钟", model: "gemini-2.5-flash-lite", fps: 0.05, lowRes: true, startS: 0, endS: 600 },
  { label: "flash fps.05 lowres / 2分钟（首片）", model: "gemini-2.5-flash", fps: 0.05, lowRes: true, startS: 0, endS: 120 },
  { label: "flash-lite fps.05 lowres / 2分钟（首片）", model: "gemini-2.5-flash-lite", fps: 0.05, lowRes: true, startS: 0, endS: 120 },
];

export async function GET(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "没有 GEMINI_API_KEY" }, { status: 500 });
  const url = new URL(request.url).searchParams.get("url") ?? "https://www.youtube.com/watch?v=qCbfTN-caFI";
  const ai = new GoogleGenAI({ apiKey });

  const results = [];
  for (const c of CONFIGS) {
    const t0 = Date.now();
    try {
      const res = await ai.models.generateContent({
        model: c.model,
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: { fileUri: url },
                videoMetadata: { startOffset: `${c.startS}s`, endOffset: `${c.endS}s`, fps: c.fps },
              },
              { text: PROMPT },
            ],
          },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: 32_768,
          thinkingConfig: { thinkingBudget: 0 },
          ...(c.lowRes ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
          abortSignal: AbortSignal.timeout(120_000),
        },
      });
      const text = res.text ?? "";
      results.push({
        label: c.label,
        ms: Date.now() - t0,
        lines: text.split("\n").filter(Boolean).length,
        inputTokens: res.usageMetadata?.promptTokenCount ?? null,
        head: text.slice(0, 120),
      });
    } catch (e) {
      results.push({
        label: c.label,
        ms: Date.now() - t0,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  }
  return NextResponse.json({ results });
}

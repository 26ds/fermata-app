import { NextResponse } from "next/server";
import { GoogleGenAI, MediaResolution } from "@google/genai";

// 一次性探针（用完即删）：让 Gemini 的原始错误自己说话。
// 创始人真机报「当天第一支视频、几秒就说额度用完」—— 那句文案是我们自己
// 用正则 /quota|RESOURCE_EXHAUSTED|429/ 猜出来的，猜错了就骗人。
// 这里把 status / name / message / 嵌套 details 原样打出来，不做任何归类。
export const maxDuration = 60;

export async function GET(request: Request) {
  const u = new URL(request.url);
  const url = u.searchParams.get("url") ?? "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  const startS = Number(u.searchParams.get("start") ?? 0);
  const endS = Number(u.searchParams.get("end") ?? 120);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no GEMINI_API_KEY" }, { status: 500 });

  const ai = new GoogleGenAI({ apiKey });
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: { fileUri: url },
              videoMetadata: { startOffset: `${startS}s`, endOffset: `${endS}s`, fps: 0.05 },
            },
            { text: "Transcribe the speech verbatim. One line per sentence: [MM:SS] text" },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 32768,
        thinkingConfig: { thinkingBudget: 0 },
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      },
    });
    return NextResponse.json({
      ok: true,
      ms: Date.now() - t0,
      usage: res.usageMetadata,
      head: (res.text ?? "").slice(0, 400),
    });
  } catch (e) {
    const err = e as Record<string, unknown> & { message?: string };
    return NextResponse.json({
      ok: false,
      ms: Date.now() - t0,
      name: err?.name ?? null,
      status: err?.status ?? null,
      code: err?.code ?? null,
      message: err?.message ?? String(e),
      // SDK 有时把真身塞在这些位置，全都翻出来
      raw: JSON.stringify(e, Object.getOwnPropertyNames(Object(e))).slice(0, 3000),
    });
  }
}

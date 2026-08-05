import { NextResponse } from "next/server";
import { glossTerm } from "@/lib/phrases/gemini-phrases";

// 一次性探针：本地没有 GEMINI_API_KEY，只有生产打得到真枪。
// **用完立刻删**（本项目 M2 起的固定做法）。

export const maxDuration = 60;

export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("term") ?? "because";
  const context =
    new URL(request.url).searchParams.get("ctx") ??
    "well then you can click away now because this video probably isn't for you.";

  const out: Record<string, unknown> = { term, context };
  for (const mode of ["language", "knowledge", "mixed"] as const) {
    try {
      out[mode] = await glossTerm({
        term,
        context,
        mode,
        contentLang: "en",
        nativeLang: "zh-Hans",
        targetLang: mode === "knowledge" ? "" : "en",
      });
    } catch (e) {
      out[mode] = `THREW: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
    }
  }
  return NextResponse.json(out);
}

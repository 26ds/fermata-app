import { NextResponse } from "next/server";
import { geminiYoutubeProvider, planChunks } from "@/lib/transcript/gemini-youtube";
import type { SourceRow } from "@/lib/types";

// ⚠️ 一次性探针（M2a-fix）—— 验完即删。
// 量的是创始人投诉的那件事：**从开始到第一段字幕上屏要多久**，以及全片总耗时。

export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url") ?? "https://www.youtube.com/watch?v=qCbfTN-caFI";
  const durationS = Number(params.get("d") ?? 1500);

  const source = {
    id: "probe",
    kind: "youtube",
    url,
    duration_s: durationS,
    transcript: null,
    transcript_status: "pending",
  } as unknown as SourceRow;

  const t0 = Date.now();
  const marks: { at: number; coveredS: number; count: number }[] = [];

  try {
    const result = await geminiYoutubeProvider.transcribe({
      source,
      existing: [],
      remainingMs: () => 240_000 - (Date.now() - t0),
      onPartial: async (p) => {
        marks.push({ at: Date.now() - t0, coveredS: p.coveredS, count: p.segments.length });
      },
    });
    const segs = result.segments;
    return NextResponse.json({
      切片表: planChunks(durationS),
      首段字幕耗时ms: marks[0]?.at ?? null,
      全片耗时ms: Date.now() - t0,
      complete: result.complete,
      count: segs.length,
      每片回来的时刻: marks,
      检查: {
        起点递增: segs.every((s, i) => i === 0 || segs[i - 1].start <= s.start),
        区间合法: segs.every((s) => s.end > s.start),
        覆盖到: segs.at(-1)?.end ?? 0,
        // 并行乱序回来后有没有排好：相邻片的接缝不能有断层
        接缝处: segs.filter((s) => s.start > 110 && s.start < 130).map((s) => s.start),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0, marks },
      { status: 500 },
    );
  }
}

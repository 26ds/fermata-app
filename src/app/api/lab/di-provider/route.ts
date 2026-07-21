import { NextResponse } from "next/server";
import { deepinfraPodcastProvider } from "@/lib/transcript/deepinfra-podcast";
import type { SourceRow, TranscriptSegment } from "@/lib/types";
import type { TranscriptProgress } from "@/lib/transcript/types";

// 一次性探针（验完即删）：整条 DeepInfra Provider 引擎跑真 mp3。
// 不是验裸接口（那次已过），是验**我写的分块+时间戳累加逻辑**：
//   - 首块解码 + 后续块顺着往下切
//   - 接缝处时间戳**连续**（关键：不能一进新块就跳回 0）
//   - 预算到点干净收尾（complete:false）
// GET /api/lab/di-provider?mp3=...&budgetMs=60000&dur=<秒>

export const maxDuration = 120;

export async function GET(request: Request) {
  const u = new URL(request.url);
  const mp3 =
    u.searchParams.get("mp3") ?? "https://content.blubrry.com/takeituneasy/lex_ai_ffmpeg.mp3";
  const budgetMs = Number(u.searchParams.get("budgetMs") ?? "60000");
  const durationS = Number(u.searchParams.get("dur") ?? "0") || null;

  const source = {
    id: "probe",
    user_id: "probe",
    kind: "podcast",
    external_id: null,
    url: mp3,
    title: null,
    content_lang: "auto",
    duration_s: durationS,
    last_position_s: null,
    transcript: null,
    transcript_status: "pending",
    created_at: "",
  } as SourceRow;

  const t0 = Date.now();
  const snaps: { segs: number; coveredS: number }[] = [];
  const pick = (s?: TranscriptSegment) =>
    s ? { start: Number(s.start.toFixed(2)), end: Number(s.end.toFixed(2)), text: s.text.slice(0, 60) } : null;

  try {
    const result = await deepinfraPodcastProvider.transcribe({
      source,
      existing: [],
      onPartial: async (p: TranscriptProgress) => {
        snaps.push({ segs: p.segments.length, coveredS: Math.round(p.coveredS) });
      },
      remainingMs: () => budgetMs - (Date.now() - t0),
    });
    const segs = result.segments;
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - t0,
      complete: result.complete,
      lang: result.lang,
      note: result.note ?? null,
      segCount: segs.length,
      partials: snaps.length,
      progressSnaps: snaps,
      first2: segs.slice(0, 2).map(pick),
      // 首块约 9 段，看第 8–12 段（接缝附近）时间是否连续往上走
      seam: segs.slice(8, 12).map(pick),
      last2: segs.slice(-2).map(pick),
      monotonic: segs.every((s, i) => i === 0 || s.start >= segs[i - 1].start),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, elapsedMs: Date.now() - t0, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) },
      { status: 500 },
    );
  }
}

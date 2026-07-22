import { NextResponse } from "next/server";
import { deepinfraPodcastProvider } from "@/lib/transcript/deepinfra-podcast";
import type { SourceRow } from "@/lib/types";

// 一次性探针（验完即删）：跑**真·Provider**（修好的那份），确认 m4a 端到端出字幕。
// GET /api/lab/pod-verify?audio=<m4a>&dur=3132&budgetMs=240000

export const maxDuration = 300;

interface Snap {
  segs: number;
  coveredS: number;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const audio = url.searchParams.get("audio");
  if (!audio) return NextResponse.json({ ok: false, error: "缺 audio" }, { status: 400 });
  const durS = Number(url.searchParams.get("dur") ?? "3132");
  const budgetMs = Number(url.searchParams.get("budgetMs") ?? "240000");

  const source = {
    id: "probe",
    user_id: "probe",
    kind: "podcast",
    url: audio,
    external_id: "probe#1",
    duration_s: durS,
    transcript: null,
    transcript_status: "pending",
  } as unknown as SourceRow;

  const t0 = Date.now();
  const snaps: Snap[] = [];
  try {
    const res = await deepinfraPodcastProvider.transcribe({
      source,
      existing: [],
      onPartial: async (p) => {
        snaps.push({ segs: p.segments.length, coveredS: Math.round(p.coveredS) });
      },
      remainingMs: () => budgetMs - (Date.now() - t0),
    });
    const segs = res.segments;
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - t0,
      complete: res.complete,
      lang: res.lang ?? null,
      note: res.note ?? null,
      segCount: segs.length,
      partials: snaps.length,
      snaps,
      first2: segs.slice(0, 2).map((s) => ({ start: s.start, end: s.end, text: s.text.slice(0, 55) })),
      last1: segs.slice(-1).map((s) => ({ start: s.start, end: s.end, text: s.text.slice(0, 55) })),
      monotonic: segs.every((s, i, a) => i === 0 || s.start >= a[i - 1].start),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      elapsedMs: Date.now() - t0,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      snaps,
    });
  }
}

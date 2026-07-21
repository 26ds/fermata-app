import { NextResponse } from "next/server";

// 一次性探针（验完即删）：DeepInfra Whisper 的真实接口形状。
// 2b 从 Groq 改判 DeepInfra，分块策略原来是照 Groq 写的，必须先确认 DeepInfra：
//   ① 收不收"裸 mp3 字节块"（multipart 文件上传）
//   ② verbose_json 给不给段级时间戳 + 语言
//   ③ mp3 中段（没有文件头）能不能单独解码
//   ④ 顺带：收不收 url 参数（省得自己下）
//
// 打法：GET /api/lab/di-probe?mp3=...&start=...&len=...&mode=file|url-openai|url-native
// 本机没 .env.local，只能靠生产环境的 DEEPINFRA_API_KEY，所以放这里用真 IP 打。

export const maxDuration = 120;

const OPENAI_ENDPOINT = "https://api.deepinfra.com/v1/openai/audio/transcriptions";
const NATIVE_ENDPOINT = "https://api.deepinfra.com/v1/inference/openai/whisper-large-v3-turbo";
const MODEL = "openai/whisper-large-v3-turbo";

interface Seg {
  start: number;
  end: number;
  text: string;
}

function summarize(json: unknown): Record<string, unknown> {
  const j = json as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Seg[];
    results?: unknown;
  };
  const segs = Array.isArray(j.segments) ? j.segments : [];
  return {
    language: j.language ?? null,
    duration: j.duration ?? null,
    segmentCount: segs.length,
    first3: segs.slice(0, 3).map((s) => ({
      start: s.start,
      end: s.end,
      text: (s.text ?? "").slice(0, 80),
    })),
    textHead: (j.text ?? "").slice(0, 120),
    // 有些接口把结果塞在 results 里，形状不一样就把顶层键列出来看看
    topKeys: json && typeof json === "object" ? Object.keys(json as object) : [],
  };
}

export async function GET(request: Request) {
  const key = process.env.DEEPINFRA_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "DEEPINFRA_API_KEY 没配" }, { status: 500 });
  }

  const url = new URL(request.url);
  const mp3 =
    url.searchParams.get("mp3") ??
    "https://content.blubrry.com/takeituneasy/lex_ai_ffmpeg.mp3";
  const start = Number(url.searchParams.get("start") ?? "0");
  const len = Number(url.searchParams.get("len") ?? String(1_500_000));
  const mode = url.searchParams.get("mode") ?? "file";

  const report: Record<string, unknown> = { mp3, start, len, mode };

  try {
    // === mode=url-*：把 mp3 地址直接交给 DeepInfra，看它收不收 ===
    if (mode === "url-openai" || mode === "url-native") {
      const endpoint = mode === "url-openai" ? OPENAI_ENDPOINT : NATIVE_ENDPOINT;
      const form = new FormData();
      if (mode === "url-openai") {
        form.append("model", MODEL);
        form.append("response_format", "verbose_json");
        form.append("url", mp3);
      } else {
        form.append("audio", mp3);
      }
      const di = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(100_000),
      });
      const raw = await di.text();
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* 不是 JSON 就留原文 */
      }
      report.diStatus = di.status;
      report.result =
        di.ok && typeof parsed === "object" ? summarize(parsed) : String(raw).slice(0, 400);
      return NextResponse.json({ ok: di.ok, ...report });
    }

    // === mode=file：Range 下一段字节 → multipart 传给 DeepInfra ===
    const rangeRes = await fetch(mp3, {
      headers: { Range: `bytes=${start}-${start + len - 1}` },
      signal: AbortSignal.timeout(60_000),
    });
    report.rangeStatus = rangeRes.status; // 期望 206 Partial Content
    report.contentRange = rangeRes.headers.get("content-range");
    const bytes = new Uint8Array(await rangeRes.arrayBuffer());
    report.bytesGot = bytes.byteLength;

    const form = new FormData();
    form.append("model", MODEL);
    form.append("response_format", "verbose_json");
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "chunk.mp3");

    const t0 = Date.now();
    const di = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(100_000),
    });
    report.diMs = Date.now() - t0;
    report.diStatus = di.status;

    const raw = await di.text();
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* 不是 JSON 就留原文 */
    }
    report.result =
      di.ok && typeof parsed === "object" ? summarize(parsed) : String(raw).slice(0, 400);

    return NextResponse.json({ ok: di.ok, ...report });
  } catch (e) {
    report.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json({ ok: false, ...report }, { status: 500 });
  }
}

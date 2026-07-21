import { NextResponse } from "next/server";

// 一次性探针（验完即删）：诊断小宇宙 m4a 为什么转不出字幕。
// 怀疑：首块只切 1.5MB 前缀，mp3 能解、m4a 的截断前缀 DeepInfra 解不了 → 400 → 整条失败。
// 一枪同时验：① CDN 让不让 HEAD/Range（Vercel IP）② 前缀能不能解（复现 bug）③ 整文件能不能解（验修法）。
//
// GET /api/lab/m4a-probe?audio=<m4a 直链>[&maxWhole=52428800]

export const maxDuration = 300;

const ENDPOINT = "https://api.deepinfra.com/v1/openai/audio/transcriptions";
const MODEL = "openai/whisper-large-v3-turbo";
const UA = "Fermata/1.0 (+podcast client)";

async function di(key: string, buf: ArrayBuffer, mime: string, name: string) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  form.append("file", new Blob([buf], { type: mime }), name);
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(280_000),
  });
  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 非 JSON */
  }
  const j = parsed as { language?: string; duration?: number; segments?: { start: number; end: number; text: string }[] };
  const segs = Array.isArray(j.segments) ? j.segments : [];
  return {
    status: res.status,
    ms: Date.now() - t0,
    ok: res.ok,
    language: j.language ?? null,
    duration: j.duration ?? null,
    segmentCount: segs.length,
    first: segs.slice(0, 2).map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").slice(0, 70) })),
    errorHead: res.ok ? null : String(raw).slice(0, 200),
  };
}

function sniff(b: Uint8Array): string {
  if (b.length < 12) return "too-short";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = new TextDecoder().decode(b.slice(8, 12));
    return `m4a(ftyp:${brand})`;
  }
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "mp3(ID3)";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3(sync)";
  return `unknown(${[...b.slice(0, 4)].map((x) => x.toString(16)).join(" ")})`;
}

export async function GET(request: Request) {
  const key = process.env.DEEPINFRA_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "DEEPINFRA_API_KEY 没配" }, { status: 500 });

  const url = new URL(request.url);
  const audio = url.searchParams.get("audio");
  if (!audio) return NextResponse.json({ ok: false, error: "缺 audio 参数" }, { status: 400 });
  const maxWhole = Number(url.searchParams.get("maxWhole") ?? "52428800"); // 默认 50MB

  const report: Record<string, unknown> = { audio };

  try {
    // ① HEAD：CDN 从 Vercel IP 给不给大小/类型/Range
    const head = await fetch(audio, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) }).catch(
      () => null,
    );
    report.head = {
      status: head?.status ?? "HEAD失败",
      contentLength: head?.headers.get("content-length") ?? null,
      contentType: head?.headers.get("content-type") ?? null,
      acceptRanges: head?.headers.get("accept-ranges") ?? null,
    };
    const totalBytes = Number(head?.headers.get("content-length") ?? 0) || 0;

    // ② 首块 1.5MB 前缀 → sniff → DeepInfra（复现 bug）
    const pref = await fetch(audio, {
      headers: { Range: "bytes=0-1499999", "user-agent": UA },
      signal: AbortSignal.timeout(60_000),
    });
    const prefBuf = await pref.arrayBuffer();
    report.prefix = {
      rangeStatus: pref.status, // 206=支持Range；200=不支持(回了整段)
      bytesGot: prefBuf.byteLength,
      sniff: sniff(new Uint8Array(prefBuf.slice(0, 16))),
      deepinfra: await di(key, prefBuf.slice(0, 1_500_000), "audio/mp4", "chunk.m4a").catch((e) => `throw: ${e}`),
    };

    // ③ 整文件 → DeepInfra（验修法）。太大就不下，免得探针自己超时
    if (totalBytes > 0 && totalBytes <= maxWhole) {
      const whole = await fetch(audio, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(150_000) });
      const wholeBuf = await whole.arrayBuffer();
      report.whole = {
        fetchStatus: whole.status,
        bytes: wholeBuf.byteLength,
        deepinfra: await di(key, wholeBuf, "audio/mp4", "audio.m4a").catch((e) => `throw: ${e}`),
      };
    } else {
      report.whole = { skipped: `totalBytes=${totalBytes}（0=HEAD没给大小 / 超过 maxWhole=${maxWhole}）` };
    }

    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    report.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json({ ok: false, ...report }, { status: 500 });
  }
}

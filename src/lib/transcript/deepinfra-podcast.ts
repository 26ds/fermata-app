import type { SourceRow, TranscriptSegment } from "@/lib/types";
import {
  TranscribeError,
  type TranscribeContext,
  type TranscribeResult,
  type TranscriptProvider,
} from "./types";

// M2b — 播客的兜底转写：把音频分块下载、逐块喂给 DeepInfra 的 Whisper，逐段拿回字幕。
//
// 为什么是 DeepInfra 而不是 Groq（2026-07-21 换商）：同一个 whisper-large-v3-turbo，
// DeepInfra $0.012/小时 < Groq $0.04/小时，且 Groq 的付费 Dev 层对新号关闭。
//
// 下面每条约束都是**生产环境探针实测**出来的（换商必须先探后写，本机没 key）：
//   ① 接口只收「上传的文件」，不收 url 参数 → 必须自己切好字节块再传（422 Field required: file）。
//   ② `verbose_json` 给 segment 级 start/end/text + 顶层 language + duration。
//   ③ **mp3 中段（没有文件头）能单独解码** —— 从 50MB 处切 1.5MB，照样解出连贯文本。
//      这条是分块转写的地基：mp3 可以任意按字节切。
//   ④ 快：1.5MB（≈2 分钟音频）约 2 秒转完 → 抢 10 秒首屏毫无压力。
//
// D3/§10 红线：音频**只在内存里过一道**，转完即弃，一个字节都不落盘。

const ENDPOINT = "https://api.deepinfra.com/v1/openai/audio/transcriptions";
const MODEL = "openai/whisper-large-v3-turbo";

/** 首块只切 1.5MB（≈2 分钟）抢首屏 —— 探针实测这块约 2 秒就回来了 */
const FIRST_BYTES = 1_500_000;
/** 其余每块 8MB（≈11 分钟）。再大没必要，下载+上传的往返才是大头 */
const CHUNK_BYTES = 8_000_000;
/**
 * m4a/mp4 的中段没有文件头、单独切出来解不了码（探针在 2a 就验过：moov 在文件最前面，
 * 只有「从头的前缀」可解）。所以 m4a 只能整文件一次转，受这个上限约束。
 * 50MB ≈ 50 分钟音频，小宇宙一集（43 分钟 ≈ 42MB）够用；再长的只转开头并如实说明。
 */
const MAX_WHOLE_M4A = 50_000_000;

/** 单块最长等这么久 */
const CHUNK_TIMEOUT_MS = 120_000;
/** 剩余预算不够开下一块就干净收尾（留 partial，剩下交给「继续生成」）。宁可分两次不要 504 */
const MIN_BUDGET_MS = 30_000;

const UA = "Fermata/1.0 (+podcast client)";

interface DiSegment {
  start: number;
  end: number;
  text: string;
}
interface DiResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: DiSegment[];
}

/** 文件太大（m4a 整文件超上限）——不是"失败"，是"只能转一部分"，单独一类好降级 */
class DiTooLarge extends Error {}

function keyOrThrow(): string {
  const key = process.env.DEEPINFRA_API_KEY;
  if (!key) throw new TranscribeError("服务器还没配置 DEEPINFRA_API_KEY");
  return key;
}

/** DeepInfra 的报错翻成人话 / 分类。余额、密钥是要用户去处理的（TranscribeError，会停下并显示） */
function diError(status: number, raw: string): Error {
  let msg = raw;
  try {
    const j = JSON.parse(raw) as { detail?: { error?: string } | string; error?: string };
    msg =
      (typeof j.detail === "object" ? j.detail?.error : j.detail) ??
      j.error ??
      raw;
  } catch {
    /* 不是 JSON 就用原文 */
  }
  if (status === 402 || /balance/i.test(msg)) {
    return new TranscribeError(
      "DeepInfra 账户余额不足 —— 去 deepinfra.com 的 Billing 充一点余额，再回来点「继续生成」。",
    );
  }
  if (status === 401 || status === 403) {
    return new TranscribeError("DeepInfra 密钥无效或没权限，检查一下 Vercel 里的 DEEPINFRA_API_KEY。");
  }
  if (status === 413 || /too large|payload|maximum|size/i.test(msg)) {
    return new DiTooLarge(String(msg).slice(0, 150));
  }
  return new Error(`DeepInfra ${status}: ${String(msg).slice(0, 150)}`);
}

async function transcribeBytes(
  key: string,
  buf: ArrayBuffer,
  mime: string,
  filename: string,
): Promise<DiResponse> {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  form.append("file", new Blob([buf], { type: mime }), filename);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
  });
  const raw = await res.text();
  if (!res.ok) throw diError(res.status, raw);
  return JSON.parse(raw) as DiResponse;
}

/** Range 取一段字节。206 是期望值，有些 CDN 会对整段回 200，也认 */
async function rangeGet(url: string, start: number, endExclusive: number): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${endExclusive - 1}`, "user-agent": UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`音频取不动（${res.status}）`);
  }
  return res.arrayBuffer();
}

async function getWhole(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(150_000), headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`音频取不动（${res.status}）`);
  return res.arrayBuffer();
}

/**
 * 靠字节头认格式，比 content-type / 扩展名可靠（不少 CDN 的 content-type 是 octet-stream）。
 * mp3 能任意切、m4a 只能整转，认错了整条转写就废，所以这一步值得。
 */
function sniff(bytes: Uint8Array): "mp3" | "m4a" | "unknown" {
  if (bytes.length < 12) return "unknown";
  // ISO-BMFF：偏移 4 处是 'ftyp'（m4a / mp4 / aac-in-mp4）
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "m4a";
  // 'ID3' 标签头，或 mp3 帧同步 0xFFEx
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return "unknown";
}

function guessByHint(url: string, ctype: string): "mp3" | "m4a" | "unknown" {
  if (/mp4|m4a|m4b|aac|x-m4a/i.test(ctype) || /\.(m4a|m4b|mp4|aac)(\?|$)/i.test(url)) return "m4a";
  if (/mpeg|mp3/i.test(ctype) || /\.mp3(\?|$)/i.test(url)) return "mp3";
  return "unknown";
}

function diToSegments(resp: DiResponse, offsetS: number): TranscriptSegment[] {
  return (resp.segments ?? [])
    .map((s) => ({ start: s.start + offsetS, end: s.end + offsetS, text: (s.text ?? "").trim() }))
    .filter((s) => s.text.length > 0);
}

/** 已经转到第几秒。空 = 一秒都没转 */
function coveredUntil(segments: TranscriptSegment[]): number {
  return segments.length === 0 ? 0 : segments[segments.length - 1].end;
}

export const deepinfraPodcastProvider: TranscriptProvider = {
  name: "deepinfra-podcast",

  supports(source: SourceRow) {
    return source.kind === "podcast" && !!source.url;
  },

  async transcribe({ source, existing, onPartial, remainingMs }: TranscribeContext): Promise<TranscribeResult> {
    const url = source.url;
    if (!url) throw new TranscribeError("这条播客没有可用的音频地址");
    const key = keyOrThrow();

    // HEAD 一下：拿总大小 + 类型 + 支不支持 Range
    const head = await fetch(url, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) }).catch(
      () => null,
    );
    const totalBytes = Number(head?.headers.get("content-length") ?? 0) || 0;
    const ctype = head?.headers.get("content-type") ?? "";
    const rangeable = (head?.headers.get("accept-ranges") ?? "").includes("bytes");

    const totalS = source.duration_s && source.duration_s > 0 ? source.duration_s : null;
    const segments: TranscriptSegment[] = Array.isArray(existing) ? [...existing] : [];
    let anchor = coveredUntil(segments);
    let format = guessByHint(url, ctype);

    // 能不能精确断点续传：要知道总时长 + 能分段下载，才能把「秒」估回「字节位置」。
    // 不满足就从头重转 —— 清掉旧段，否则会把旧段的绝对时间跟新音频错位拼在一起。
    const canResume = anchor > 0 && !!totalS && rangeable && totalBytes > 0;
    if (anchor > 0 && !canResume) {
      segments.length = 0;
      anchor = 0;
    }
    const startFresh = segments.length === 0;
    /** 这次进函数前已有多少段 —— 判断"这一轮到底转出东西没有"的基准 */
    const baseCount = segments.length;
    let lang: string | null = null;

    // ── 首块（0..1.5MB）：抢首屏 + 用字节头认格式。精确续转时跳过 ──
    let offset = startFresh ? 0 : anchor;
    if (startFresh) {
      const firstEnd = totalBytes > 0 ? Math.min(FIRST_BYTES, totalBytes) : FIRST_BYTES;
      const prefix = await rangeGet(url, 0, firstEnd);
      const sniffed = sniff(new Uint8Array(prefix.slice(0, 16)));
      if (sniffed !== "unknown") format = sniffed;

      const mime = format === "m4a" ? "audio/mp4" : "audio/mpeg";
      const name = format === "m4a" ? "chunk.m4a" : "chunk.mp3";
      const resp = await transcribeBytes(key, prefix, mime, name);
      lang = resp.language ?? null;
      segments.push(...diToSegments(resp, 0));
      segments.sort((a, b) => a.start - b.start);
      offset = resp.duration ?? coveredUntil(segments);
      await onPartial({ segments, coveredS: offset, totalS });

      // 整个文件还没首块大 → 已经转完了
      if (totalBytes > 0 && totalBytes <= firstEnd) return { segments, complete: true, lang };
    }

    // ── mp3：能任意按字节切，顺着往后转，时间戳用「前面各块实测时长之和」对齐 ──
    // （unknown 也走这条：绝大多数播客是 mp3；真是 m4a 的话中段解不出来会被下面的空块收住）
    if (format !== "m4a" && rangeable && totalBytes > 0) {
      const startByte = startFresh
        ? FIRST_BYTES
        : Math.min(Math.floor((anchor / (totalS as number)) * totalBytes), totalBytes - 1);

      for (let b0 = startByte; b0 < totalBytes; b0 += CHUNK_BYTES) {
        if (remainingMs() < MIN_BUDGET_MS) return { segments, complete: false, lang };
        const b1 = Math.min(b0 + CHUNK_BYTES, totalBytes);
        let resp: DiResponse;
        try {
          resp = await transcribeBytes(key, await rangeGet(url, b0, b1), "audio/mpeg", "chunk.mp3");
        } catch (e) {
          // 余额/密钥这类要用户处理的：这一轮转出过东西就留 partial 带原因，一点没转才硬失败
          if (e instanceof TranscribeError) {
            if (segments.length > baseCount) return { segments, complete: false, lang, note: e.message };
            throw e;
          }
          // 其它异常：有进展就收尾，否则往上抛（让链去换 / 让入口记 failed）
          if (segments.length > baseCount) {
            return { segments, complete: false, lang, note: e instanceof Error ? e.message : String(e) };
          }
          throw e;
        }
        lang = lang ?? resp.language ?? null;
        const before = segments.length;
        segments.push(...diToSegments(resp, offset));
        segments.sort((a, b) => a.start - b.start);
        // 这一块解出来的真实时长累加成下一块的起点偏移（跟码率恒不恒定无关）
        offset += resp.duration ?? (segments.length > before ? segments[segments.length - 1].end - offset : 0);
        await onPartial({ segments, coveredS: offset, totalS });
      }
      return { segments, complete: true, lang };
    }

    // ── m4a / mp4：中段切不了，只能整文件一次转（时间戳本身就是绝对的，不用加偏移）──
    if (totalBytes > 0 && totalBytes <= MAX_WHOLE_M4A) {
      if (remainingMs() < MIN_BUDGET_MS && segments.length > 0) return { segments, complete: false, lang };
      try {
        const resp = await transcribeBytes(key, await getWhole(url), "audio/mp4", "audio.m4a");
        // 整文件是权威且从 0 开始的全量结果，直接取代首块那点预览
        const full = diToSegments(resp, 0);
        if (full.length > 0) return { segments: full, complete: true, lang: resp.language ?? lang };
        return { segments, complete: segments.length > 0, lang };
      } catch (e) {
        if (e instanceof DiTooLarge) {
          // 落到这说明比我们估的还大 —— 保留首块预览，如实说明
          return {
            segments,
            complete: false,
            lang,
            note: "这一集是 m4a 且偏长，DeepInfra 一次收不下，暂时只转出了开头。",
          };
        }
        if (e instanceof TranscribeError) {
          if (segments.length > 0) return { segments, complete: false, lang, note: e.message };
          throw e;
        }
        if (segments.length > 0) return { segments, complete: false, lang, note: e instanceof Error ? e.message : String(e) };
        throw e;
      }
    }

    // ── 整文件超上限、又切不了中段：只有首块那点预览，如实说明（不假装成功）──
    if (segments.length > 0) {
      return {
        segments,
        complete: false,
        lang,
        note: "这一集是 m4a 且太长（超过约 50 分钟），暂时只转出了开头。完整转写以后再补。",
      };
    }
    // 连首块都没有（不支持 Range 又拿不到大小）：交给链上下一个 / 让入口记 failed
    throw new Error("这条音频既不支持分段下载、又读不到大小，暂时转不了");
  },
};

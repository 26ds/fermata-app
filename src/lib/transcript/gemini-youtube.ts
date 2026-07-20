import { GoogleGenAI } from "@google/genai";
import type { SourceRow, TranscriptSegment } from "@/lib/types";
import { TranscribeError, type TranscribeContext, type TranscribeResult, type TranscriptProvider } from "./types";

// M2a — YouTube 的字幕来源：让 Gemini 自己去看那段视频，逐句转写回来。
//
// 为什么不是「取 YouTube 官方字幕轨」（那本来更准更快）：
// **在 Vercel 的机房 IP 上取不到** —— 三种客户端一律被判成机器人
// （`LOGIN_REQUIRED: Sign in to confirm you're not a bot`）。我在家庭宽带上
// 验过能取，机房不行。整条路已实测作废，别再试（D27，含三条已否决的绕行）。
//
// 这条路的边界也是实测出来的，不是文档上抄的：
// 真正的墙**不是「视频超过 1 小时」，是上下文 100 万 token** —— 一支 2 小时的
// 片子整支喂进去直接 400；**切成 10 分钟一段就完全正常**（实测一段 46 秒、146 行）。

/** 一片 10 分钟。实测这个尺寸一次约 46 秒，且离 100 万 token 的墙很远 */
const CHUNK_S = 600;

/**
 * 每秒只取 0.2 帧。我们要的是**话**，不是画面 ——
 * 帧率是 Gemini 视频 token 的主要来源，压到 0.2 等于把画面 token 砍掉八成。
 */
const FPS = 0.2;

/** 一片 10 分钟实测约 1 万字符（≈3 千 token），给到 32k 足够宽裕 */
const MAX_OUTPUT_TOKENS = 32_768;

/** 单片最长等这么久。超了就当这一片失败，已转好的仍然算数 */
const CHUNK_TIMEOUT_MS = 120_000;

/** 没有话的那一片，模型会回这个（我们在 prompt 里要求的） */
const NO_SPEECH = "NO_SPEECH";

const MODEL = "gemini-2.5-flash";

const PROMPT = `Transcribe the speech in this video verbatim.
Output one line per sentence, in exactly this format:
[MM:SS] text
Rules: no commentary, no summary, no markdown, no speaker labels, no blank lines.
Keep the original language — do not translate.
If there is no speech at all, output ${NO_SPEECH}.`;

/**
 * 认 `[MM:SS]` / `[HH:MM:SS]`，也认没有方括号的 —— **模型不老实听格式**：
 * 同一个 prompt，短片那次它回的就是 `00:01 text`（方括号自己丢了）。
 * 与其跟它较劲，不如两种都认。
 */
const LINE = /^\s*\[?(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]?\s*(.+)$/;

interface ParsedLine {
  at: number;
  text: string;
}

export function parseTimestampedLines(raw: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of raw.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, h, mm, ss, text] = m;
    const at = Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
    const clean = text.trim();
    // 模型偶尔把整段包在引号或列表符号里，去掉那层壳
    const stripped = clean.replace(/^[-*•]\s*/, "").trim();
    if (stripped) out.push({ at, text: stripped });
  }
  return out;
}

/**
 * 切片回来的时间戳，**基准是漂的** —— 这条是实测撞出来的，不是想出来的：
 * 同一支视频、同一段 600–1200 秒、同一个 prompt，连打两枪，
 * 一枪回 `[00:00] I'd like to see her…`（相对片头从 0 数），
 * 一枪回 `[10:00] like to see her…`（整支视频的绝对时间）。
 *
 * 所以**不能假设是哪一种，只能当场认**：本片的时间戳如果整体落在
 * [起点, 终点] 这个窗口里，那就是绝对时间，原样用；否则当相对时间，加偏移。
 * 认错的代价很实在 —— 猜"相对"而实际是绝对，整支视频的字幕会翻倍偏移出去。
 */
export function resolveOffset(lines: ParsedLine[], startS: number, endS: number): number {
  if (startS === 0 || lines.length === 0) return 0; // 第一片两种基准是同一回事
  const min = Math.min(...lines.map((l) => l.at));
  const max = Math.max(...lines.map((l) => l.at));
  const TOL = 15; // 模型对齐没那么精确，给一点余量
  const looksAbsolute = min >= startS - TOL && max <= endS + TOL;
  return looksAbsolute ? 0 : startS;
}

/**
 * 把一片的行变成片段。
 * 模型只给起点不给终点，所以每句的终点 = 下一句的起点（最后一句用片尾兜底）。
 */
export function linesToSegments(lines: ParsedLine[], startS: number, endS: number): TranscriptSegment[] {
  const offset = resolveOffset(lines, startS, endS);
  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = offset + lines[i].at;
    // 越界的行直接丢：模型偶尔会多吐一两句片外的，留着就是字幕跳到未来
    if (start >= endS || start < startS - 1) continue;
    const nextAt = i + 1 < lines.length ? offset + lines[i + 1].at : endS;
    segments.push({
      start,
      end: Math.min(Math.max(nextAt, start + 0.5), endS),
      text: lines[i].text,
    });
  }
  return segments;
}

function clientFor(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TranscribeError("服务器还没配置 GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
}

async function transcribeChunk(
  ai: GoogleGenAI,
  url: string,
  startS: number,
  endS: number,
): Promise<TranscriptSegment[]> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: { fileUri: url },
            videoMetadata: { startOffset: `${startS}s`, endOffset: `${endS}s`, fps: FPS },
          },
          { text: PROMPT },
        ],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // 转写不需要推理，思考预算全砍掉 —— 省时间也省 token（M0.5 同款）
      thinkingConfig: { thinkingBudget: 0 },
      abortSignal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
    },
  });

  const text = res.text ?? "";
  if (text.trim().startsWith(NO_SPEECH)) return [];
  return linesToSegments(parseTimestampedLines(text), startS, endS);
}

/** 已有片段覆盖到哪儿了 → 换算成"从第几片接着转" */
function nextChunkIndex(existing: TranscriptSegment[]): number {
  if (existing.length === 0) return 0;
  const covered = existing[existing.length - 1].end;
  // 只有整片转完才算数：落在片中间说明那一片没转完，重转它
  return Math.floor(covered / CHUNK_S);
}

export const geminiYoutubeProvider: TranscriptProvider = {
  name: "gemini-youtube",

  supports(source: SourceRow) {
    return source.kind === "youtube" && !!source.url;
  },

  async transcribe({ source, existing, onPartial, remainingMs }: TranscribeContext): Promise<TranscribeResult> {
    const url = source.url;
    if (!url) throw new TranscribeError("这条内容没有可用的视频地址");

    const totalS = source.duration_s && source.duration_s > 0 ? source.duration_s : null;
    const ai = clientFor();

    // 已经转好的那部分原样保留，只往后接
    const startIndex = nextChunkIndex(existing);
    const segments = existing.filter((s) => s.start < startIndex * CHUNK_S);

    // 时长未知时也能干活：一直往后转，直到某一片彻底没内容（就是到头了）
    const lastIndex = totalS ? Math.ceil(totalS / CHUNK_S) - 1 : Number.MAX_SAFE_INTEGER;

    for (let i = startIndex; i <= lastIndex; i++) {
      const startS = i * CHUNK_S;
      const endS = totalS ? Math.min(startS + CHUNK_S, totalS) : startS + CHUNK_S;
      if (endS - startS < 1) break;

      // 一片实测约 46 秒；剩余预算不够就干净收尾，别撞 300 秒硬墙吃 504
      if (remainingMs() < 60_000) {
        return { segments, complete: false };
      }

      let chunk: TranscriptSegment[];
      try {
        chunk = await transcribeChunk(ai, url, startS, endS);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 第一片就炸 = 这条内容根本读不了，得说清楚；后面的片子炸 = 已转的仍算数
        if (i === startIndex) {
          if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
            throw new TranscribeError("今天的免费额度用完了（每天 8 小时视频），明天再试。");
          }
          if (/not found|private|unavailable|403|permission/i.test(msg)) {
            throw new TranscribeError("这支视频读不了 —— 私享 / 会员 / 地区限制的视频拿不到内容。");
          }
          throw new TranscribeError(`读这支视频时出错了：${msg.slice(0, 120)}`);
        }
        return { segments, complete: false };
      }

      // 时长未知时，空的一片就是到头了
      if (chunk.length === 0 && !totalS) break;

      segments.push(...chunk);
      await onPartial({ segments, coveredS: endS, totalS });
    }

    return { segments, complete: true };
  },
};

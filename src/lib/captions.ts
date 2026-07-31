import type { TranscriptSegment } from "@/lib/types";

// M1d — 字幕文本 → TranscriptSegment[]。
//
// M1 阶段字幕靠手动贴（.srt / .vtt），目的是**先把渲染与同步高亮验对**；
// 自动转写是 M2，那时产出的也是同一个 TranscriptSegment[]，渲染层不用改。
// 所以这个解析器是临时入口，不是临时数据结构。

/** 一条字幕最多这么多段，防止贴进来一个几万行的文件把页面卡死 */
export const MAX_SEGMENTS = 5000;

// 时间戳三种写法都得认：`01:02:03,456`（SRT）、`01:02:03.456`（VTT）、`02:03.456`（省略小时）
const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const CUE_LINE = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}`);

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return (
    Number(h ?? 0) * 3600 +
    Number(m) * 60 +
    Number(s) +
    Number(ms.padEnd(3, "0")) / 1000
  );
}

/**
 * 清掉字幕里的标记：
 * - `<v 说话人>` / `<c.colorE5E5E5>` / `</c>` —— VTT 的行内标签
 * - `<00:00:12.345>` —— YouTube 自动字幕的逐词卡拉 OK 时间戳，留着满屏尖括号
 * - `{\an8}` —— 老 SRT 的位置指令
 */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 解析 SRT / WebVTT。认不出任何一条 cue 就返回空数组 —— 由调用方决定怎么提示。
 *
 * 不做的事：不合并、不断句、不纠时间。贴进来什么样，就按什么样播。
 */
export function parseCaptions(input: string): TranscriptSegment[] {
  // \r\n 与孤立的 \r 都要归一，否则 SRT（多半是 CRLF）会每行尾巴挂一个 \r
  const lines = input.replace(/\r\n?/g, "\n").split("\n");

  const out: TranscriptSegment[] = [];
  let current: { start: number; end: number; text: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = stripMarkup(current.text.join(" "));
    // 空 cue 直接丢；与上一条完全同文的也丢 ——
    // YouTube 自动字幕是滚动式的，同一句会连着出现两三遍
    if (text && out[out.length - 1]?.text !== text) {
      out.push({ start: current.start, end: current.end, text });
    }
    current = null;
  };

  for (const line of lines) {
    const cue = CUE_LINE.exec(line);
    if (cue) {
      flush();
      const start = toSeconds(cue[1], cue[2], cue[3], cue[4]);
      const end = toSeconds(cue[5], cue[6], cue[7], cue[8]);
      // 结束早于开始的坏行：给它一个兜底时长，别产出负区间
      current = { start, end: end > start ? end : start + 2, text: [] };
      continue;
    }
    if (!current) continue; // cue 之前的东西（WEBVTT 头、序号、NOTE）一律跳过
    if (line.trim() === "") {
      flush();
      continue;
    }
    current.text.push(line.trim());
  }
  flush();

  return out.sort((a, b) => a.start - b.start).slice(0, MAX_SEGMENTS);
}

/**
 * YouTube「显示转录 / Show transcript」面板复制出来的格式 —— 跟 SRT/VTT 不一样：
 * **一行时间戳、下一行文字，交替**，没有 `-->`。例：
 *
 *   0:00
 *   Hey everyone, welcome back
 *   0:04
 *   today we're talking about…
 *
 * 也认「时间戳和文字挤在同一行」的复制方式（`0:00 Hey everyone` / 用 Tab 分隔）。
 * 每句的终点 = 下一句的起点（最后一句给 4 秒兜底）。这是创始人要的免费通路：
 * YouTube 自己就有 CC，用户点三下复制过来，我们不用花钱让模型重转。
 */
const YT_TS = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\s+(.*))?$/;

export function parseYoutubeTranscript(input: string): TranscriptSegment[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const entries: { at: number; text: string[] }[] = [];
  let current: { at: number; text: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    const m = YT_TS.exec(line);
    if (m) {
      const at = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      current = { at, text: [] };
      entries.push(current);
      if (m[4]) current.text.push(m[4].trim()); // 时间戳同一行还带着文字
      continue;
    }
    // 普通文字行，挂到当前时间戳名下；时间戳还没出现的前导行（面板标题）直接丢
    if (current) current.text.push(line);
  }

  const out: TranscriptSegment[] = [];
  for (let i = 0; i < entries.length; i++) {
    const text = stripMarkup(entries[i].text.join(" "));
    if (!text) continue;
    // 与上一条同文的丢：自动字幕偶尔会连着重复一句
    if (out[out.length - 1]?.text === text) continue;
    const start = entries[i].at;
    const nextAt = i + 1 < entries.length ? entries[i + 1].at : start + 4;
    out.push({ start, end: Math.max(nextAt, start + 0.5), text });
  }

  return out.sort((a, b) => a.start - b.start).slice(0, MAX_SEGMENTS);
}

/**
 * 用户手动粘贴的字幕，来源不止一种，这里**兜住所有认得出的格式**：
 * 先按 SRT/VTT（带 `-->`）解析，一条都没有再退回 YouTube 转录格式。
 * 两种都认不出才返回空，由调用方提示。
 */
export function parseTranscript(input: string): TranscriptSegment[] {
  const cues = parseCaptions(input);
  if (cues.length > 0) return cues;
  return parseYoutubeTranscript(input);
}

/**
 * M3.5 —— 窗口 [start,end] 内（有重叠即算）的原句。
 *
 * 暂停点回看的右侧「那一刻的字幕」靠它切：**纯前端、从已加载的 transcript 里取，不发请求**。
 * 为什么是字幕而不是那一帧画面：D21 —— YouTube 是跨域 iframe 抓不到帧，播客根本没画面，
 * 硬做只会做出"有的有图、有的空白"。字幕每条内容都一定有。
 *
 * 服务端 gemini-ask.windowText 是同一个口径，但那份带 Gemini 客户端依赖，
 * 客户端不能碰（D24），所以这里独立一份纯函数。
 */
export function segmentsInWindow(
  segments: TranscriptSegment[],
  startS: number,
  endS: number,
): TranscriptSegment[] {
  return segments.filter((s) => s.start <= endS && s.end >= startS);
}

/** 句末标点：中英都要认。英文的 . ! ? 要求后面是空白或结尾，免得把 3.5 / U.S. 断开 */
const SENTENCE_END = /[。！？…；]|[.!?](?=\s|$)/;

/**
 * 取首句，太长就掐掉。用来做暂停点那一行「为什么在这儿停」的一句话。
 * 一句话就是一句话 —— 宁可掐尾，也不换行挤成两行把列表撑散。
 */
export function firstSentence(text: string, maxLen = 46): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = SENTENCE_END.exec(t);
  const head = m ? t.slice(0, m.index + 1) : t;
  return head.length > maxLen ? `${head.slice(0, maxLen)}…` : head;
}

/**
 * 找出"现在该高亮哪一句"。二分，因为这个函数每 250ms 跑一次。
 * 落在两句之间（说话人换气）时保持上一句亮着 —— 字幕突然全灭比慢半拍难受。
 */
export function activeSegmentIndex(segments: TranscriptSegment[], t: number): number {
  if (segments.length === 0 || t < segments[0].start) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

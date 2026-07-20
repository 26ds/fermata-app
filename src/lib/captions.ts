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

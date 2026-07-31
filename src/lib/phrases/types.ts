import { activeSegmentIndex } from "@/lib/captions";
import type { StudyMode } from "@/lib/lang";
import type { TranscriptSegment } from "@/lib/types";

// M3.7 词库 —— 扫描结果的形状 + **把它对齐回当前字幕**的纯函数（D40）。
//
// **D24：这份必须客户端可用**，一行 Gemini 依赖都不许有 —— 字幕层要靠它决定
// 每一行高亮哪一段。真正花钱的扫描在 `gemini-phrases.ts`（只跑在服务端）。

/** 一个被标出来的词组 */
export interface PhraseItem {
  /** 字幕段下标（扫描当时的） */
  i: number;
  /** 那一段的起始秒 —— 字幕变了时的兜底定位，也是收藏时写进 `atoms.t_s` 的值 */
  t: number;
  /** 词组在 `segments[i].text` 里的字符起点。**服务端 indexOf 算的，不是模型数的** */
  start: number;
  /** 词组原文（一字不差照抄字幕） */
  text: string;
  /** 一句话解释，用用户母语写 */
  gloss: string;
}

/** 存进 `sources.phrases` 的整坨。带版本号，将来能演进而不用猜旧数据长什么样 */
export interface PhraseScan {
  v: 1;
  /** 扫的时候是什么模式（学语言 / 学知识 / 混合）—— 用户改了目标语言就得重扫 */
  mode: StudyMode;
  /** 扫的时候认定的内容语言 */
  contentLang: string;
  /** 解释用的语言（= 当时的母语） */
  supportLang: string;
  /** 扫的时候字幕有多少段 —— 和现在对不上就说明字幕换过了 */
  segCount: number;
  /** 已经扫到第几段（不含）。< segCount 说明预算用完了，下次接着扫 */
  scannedThrough: number;
  scannedAt: string;
  items: PhraseItem[];
}

/** 版本对得上、形状像样，才认它是一份扫描结果 */
export function isPhraseScan(v: unknown): v is PhraseScan {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<PhraseScan>;
  return s.v === 1 && Array.isArray(s.items);
}

/**
 * 宽松定位：先精确，再不区分大小写。**两种都不改变长度**，
 * 所以算出来的字符起点对高亮切片仍然准确。
 */
function looseIndexOf(hay: string, needle: string): number {
  if (!needle) return -1;
  const exact = hay.indexOf(needle);
  if (exact >= 0) return exact;
  return hay.toLowerCase().indexOf(needle.toLowerCase());
}

/**
 * 把扫描结果对齐回**当前**字幕，返回 `段下标 → 这一段要高亮的词组`。
 *
 * 为什么必须校验：`i` 是扫描当时的段下标，而字幕会变 —— 转到一半的字幕会继续长、
 * 用户还能重新粘一份盖掉。下标一旦错位，高亮就标到别的句子上，
 * **那比不高亮糟得多**（用户会以为我们在瞎标）。
 *
 * 所以每条都要求「`segments[i]` 里真的有这段原文」；对不上就按时间找最近的一段再试一次；
 * 还不行就**丢掉这条**。最坏情况是少几个高亮，绝不会标错地方。
 *
 * 每段只留一个（D40：每行封顶 1 个）。
 */
export function resolvePhrases(
  scan: PhraseScan | null | undefined,
  segments: TranscriptSegment[],
): Map<number, PhraseItem> {
  const out = new Map<number, PhraseItem>();
  if (!scan || segments.length === 0) return out;

  for (const item of scan.items) {
    if (!item?.text) continue;
    // 候选位置：扫描当时记的下标，其次按时间找回来的那一段
    const byTime = activeSegmentIndex(segments, item.t);
    for (const idx of [item.i, byTime]) {
      if (idx == null || idx < 0 || idx >= segments.length) continue;
      // 这一段已经有高亮了（每行封顶 1 个）—— 但这条词组可能属于**另一个**候选位置，
      // 所以是换下一个候选接着试，不是把它整条丢掉
      if (out.has(idx)) continue;
      const pos = looseIndexOf(segments[idx].text, item.text);
      if (pos < 0) continue;
      out.set(idx, { ...item, i: idx, start: pos });
      break;
    }
  }
  return out;
}

/** 把一段字幕按高亮切成三截（前 / 高亮 / 后）。没有高亮就只有前一截 */
export function splitByPhrase(
  text: string,
  phrase: PhraseItem | undefined,
): { before: string; hit: string; after: string } {
  if (!phrase || phrase.start < 0 || phrase.start >= text.length) {
    return { before: text, hit: "", after: "" };
  }
  const end = phrase.start + phrase.text.length;
  return {
    before: text.slice(0, phrase.start),
    // 用原文那一段而不是模型给的 text —— 大小写以字幕为准
    hit: text.slice(phrase.start, end),
    after: text.slice(end),
  };
}

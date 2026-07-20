// 字幕提供者链 — WORKORDER §4 的 TranscriptProvider，M2 补齐两处 §4 没定义的东西。
//
// 信条与 sources/ 那一层一致：除了 registry.ts，没有第二处代码知道
// 「这条内容的字幕该找谁要」。上层只认 TranscriptSegment[]。

import type { SourceRow, TranscriptSegment } from "@/lib/types";

/**
 * 一次转写的进展。Provider 每产出一块就回一次 —— 用户能立刻看见字幕在长，
 * 而不是盯着一个转圈等三分钟。
 */
export interface TranscriptProgress {
  /** 到目前为止的**全部**片段（不是增量），已按 start 排好序 */
  segments: TranscriptSegment[];
  /** 已经覆盖到第几秒。用来算进度条，也用来断点续传 */
  coveredS: number;
  /** 全片总长（秒）。不知道就是 null */
  totalS: number | null;
}

export interface TranscribeContext {
  source: SourceRow;
  /**
   * 上次转到一半留下的片段（`transcript_status = 'partial'`）。
   * Provider 要**接着这些往后转**，不是从头再来 —— 重转一遍既费钱又费时间。
   */
  existing: TranscriptSegment[];
  /** 出一块回一块。返回的是累计结果，调用方直接落库 + 推给浏览器 */
  onPartial(progress: TranscriptProgress): Promise<void>;
  /**
   * 软时间预算的剩余毫秒。Provider 每转完一块就问一次，
   * 不够再转一块就**干净收尾**（已转的都算数，状态留 partial）。
   * 宁可分两次，也不要撞 Vercel 的 300 秒硬墙吃 504。
   */
  remainingMs(): number;
}

export interface TranscribeResult {
  segments: TranscriptSegment[];
  /** 全片转完了没有。false = 还剩一截，等下次「继续生成」 */
  complete: boolean;
  /** Whisper 会顺便告诉我们这是什么语言 → 回写 sources.content_lang（D10） */
  lang?: string | null;
}

export interface TranscriptProvider {
  name: string;
  /** 认不认这条内容。不认就交给链上的下一个 */
  supports(source: SourceRow): boolean;
  transcribe(ctx: TranscribeContext): Promise<TranscribeResult>;
}

/**
 * 转写失败且**原因该讲给用户听**时抛这个（→ 落库 failed + 中文原文）。
 * 其余异常一律当成"抽风"，提示重试。与 SourceResolveError 同款分工。
 */
export class TranscribeError extends Error {}

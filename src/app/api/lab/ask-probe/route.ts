import { NextResponse } from "next/server";
import { askQuestion } from "@/lib/ask/gemini-ask";
import type { TranscriptSegment } from "@/lib/types";

// M3 探针 —— 验 gemini-ask 引擎：① 流式逐块回；② 答案扣接地。
// 生造词「蓝鲸缓存」只在窗口里定义，训练数据里没有 —— 答对就证明真读了字幕，不是背出来的。
// 「适合季度报表」故意放在窗口外（全文背景）—— 答里带上它就证明全文背景也生效。
// 本机没 GEMINI_API_KEY，只能在生产打真枪。**验完即删**（先探后写纪律）。

export const maxDuration = 60;

export async function GET() {
  const segments: TranscriptSegment[] = [
    { start: 0, end: 10, text: "上一节我们聊了普通的内存缓存怎么失效。" },
    { start: 10, end: 20, text: "今天换个话题，先说说为什么大文件要分片。" },
    // ↓ 窗口 [27,45] 内：蓝鲸缓存的定义
    { start: 30, end: 38, text: "重点来了：讲师把这种把冷数据沉到最底层、平时不唤醒的做法，叫做蓝鲸缓存。" },
    { start: 38, end: 45, text: "蓝鲸缓存的关键是：它一次沉睡能扛几个月不被读取，醒来却只要三百毫秒。" },
    // ↓ 窗口外（背景）：它的用途
    { start: 46, end: 55, text: "所以蓝鲸缓存特别适合季度报表这种半年才看一次的数据。" },
    { start: 55, end: 70, text: "下一段我们讲怎么给它设过期时间。" },
  ];
  const tS = 42;
  const windowStartS = tS - 15; // 27
  const windowEndS = tS + 3; // 45

  const chunks: string[] = [];
  const startedAt = Date.now();
  let error: string | null = null;
  let answer = "";
  try {
    answer = await askQuestion({
      question: "蓝鲸缓存是什么意思？它适合放什么数据？",
      segments,
      windowStartS,
      windowEndS,
      tS,
      title: "缓存设计课",
      onChunk: (t) => {
        chunks.push(t);
      },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    error,
    elapsedMs: Date.now() - startedAt,
    chunkCount: chunks.length,
    streamed: chunks.length > 1,
    // 扣窗口：提到蓝鲸 + 定义关键词；扣全文：提到季度/报表
    groundedWindow: /蓝鲸/.test(answer) && /(冷数据|沉|三百|300|毫秒|几个月|沉睡)/.test(answer),
    groundedFull: /(季度|报表|半年)/.test(answer),
    answer,
  });
}

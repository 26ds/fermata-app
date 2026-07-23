import { NextResponse } from "next/server";
import { askChat, compactChat } from "@/lib/ask/gemini-chat";
import type { TranscriptSegment } from "@/lib/types";

// M3 Phase-2 探针 —— 验沉浸聊天引擎：
//   ① askChat 多轮：问题用指代「它」，只有真读了本次会话历史才知道"被搞混成动物"；顺带验流式。
//   ② compactChat：把对话浓缩成备忘，要抓住用户明显没懂的点（TTL/LRU 区别）。
// 本机没 GEMINI_API_KEY，生产打真枪。**验完即删**。

export const maxDuration = 60;

export async function GET() {
  const segments: TranscriptSegment[] = [
    { start: 0, end: 10, text: "这节课讲缓存怎么设过期。" },
    { start: 10, end: 25, text: "常见两种淘汰：TTL 按时间到点作废，LRU 按最久没用作废。" },
    { start: 25, end: 40, text: "蓝鲸缓存是把冷数据沉到最底层、平时不唤醒的策略，不是某种动物。" },
    { start: 40, end: 60, text: "季度报表这种半年看一次的，用蓝鲸缓存最合适。" },
  ];

  // ① askChat：多轮 + 历史指代 + 流式
  const chatChunks: string[] = [];
  let chatErr: string | null = null;
  let chatAnswer = "";
  try {
    chatAnswer = await askChat({
      question: "那我刚才把它搞混成什么了？",
      segments,
      atS: 30,
      title: "缓存设计课",
      priorSummary: "用户之前不太理解缓存的过期时间。",
      liveTurns: [
        { role: "user", text: "我一开始把「蓝鲸缓存」理解成了一种动物，其实搞混了。" },
        { role: "assistant", text: "对，蓝鲸缓存其实是个缓存策略，不是动物。" },
      ],
      onChunk: (t) => {
        chatChunks.push(t);
      },
    });
  } catch (e) {
    chatErr = e instanceof Error ? e.message : String(e);
  }

  // ② compactChat：以用户问题 + 不懂点为主
  let compactErr: string | null = null;
  let summary = "";
  try {
    summary = await compactChat({
      title: "缓存设计课",
      priorSummary: null,
      turns: [
        { role: "user", text: "TTL 和 LRU 到底啥区别？我没听懂。" },
        { role: "assistant", text: "TTL 按时间到点作废，LRU 按最久没用作废。" },
        { role: "user", text: "那蓝鲸缓存又是啥？跟这俩什么关系？" },
        { role: "assistant", text: "蓝鲸缓存是把冷数据沉底，和淘汰策略是两回事。" },
      ],
    });
  } catch (e) {
    compactErr = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    chat: {
      error: chatErr,
      chunkCount: chatChunks.length,
      streamed: chatChunks.length > 1,
      usedHistory: /动物|蓝鲸/.test(chatAnswer), // 只有读了本次会话历史才答得出"搞混成动物"
      answer: chatAnswer,
    },
    compact: {
      error: compactErr,
      capturedConfusion: /(TTL|LRU|区别|没懂|混淆|蓝鲸)/.test(summary),
      summary,
    },
  });
}

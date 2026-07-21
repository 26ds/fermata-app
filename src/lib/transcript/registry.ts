import type { SourceKind } from "@/lib/types";
import { geminiYoutubeProvider } from "./gemini-youtube";
import { podcastTranscriptProvider } from "./podcast-transcript";
import { deepinfraPodcastProvider } from "./deepinfra-podcast";
import type { TranscriptProvider } from "./types";

// 字幕提供者链 — WORKORDER §4「按序尝试，成功即止」。
//
// ⚠️ **服务端专用**（D24 同款纪律）：这里的 Provider 会 import Gemini SDK、
// 将来还会 import 播客那套音频分块逻辑。客户端组件一旦 import 到这个文件，
// 整条服务端依赖链就会被拽进浏览器包。
// 验证方式固定：`grep -rl "@google/genai" .next/static/chunks/` 必须为空。

const CHAINS: Partial<Record<SourceKind, TranscriptProvider[]>> = {
  // YouTube 只有这一条路（D27：官方字幕轨在机房 IP 上取不到，已实测作废）
  youtube: [geminiYoutubeProvider],
  // 播客（2b）：<podcast:transcript>（白捡，约 1/8 命中）→ DeepInfra Whisper 分块（兜底，主力）
  podcast: [podcastTranscriptProvider, deepinfraPodcastProvider],
};

export function providersFor(kind: SourceKind): TranscriptProvider[] {
  return CHAINS[kind] ?? [];
}

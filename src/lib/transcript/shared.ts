import type { TranscriptSegment } from "@/lib/types";

// 2026-09-26（公开仓库那一片，D31 补记 · 粘贴的字幕创始人选 B）——
// 共享**译文**缓存只收「全站共享的那份字幕」翻出来的译文。
//
// 为什么要比：`/api/translate` 翻的是**他自己那条 sources 里的字幕**，可能是他粘贴的。
// 从 B 起粘贴的字幕只归他自己（不进 transcript_cache）；由它翻出来的译文要是还进共享缓存，
// 有人就能先贴一份假字幕、再点翻译，把假译文塞给之后打开同一支视频的所有人。
// 共享字幕缓存从迁移 0014 起只有服务器能写、只收机器转写 ——
// 所以「和它逐行一样」就等于「翻的是机器转的那份」。
//
// 纯函数（不 import server-only）：单元测试直接跑（tests/shared-caches.test.ts）。

/** 他这份字幕和共享缓存里那份是不是**逐行一样**（同样多行、每行起点秒和原文都相同） */
export function sameTranscript(
  mine: readonly TranscriptSegment[],
  shared: readonly TranscriptSegment[],
): boolean {
  if (mine.length === 0 || mine.length !== shared.length) return false;
  for (let i = 0; i < mine.length; i++) {
    if (mine[i].text !== shared[i].text || Math.abs(mine[i].start - shared[i].start) > 0.01) {
      return false;
    }
  }
  return true;
}

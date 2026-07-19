import type { ParsedSource, ResolvedMeta, SourceAdapter } from "./types";
import { YouTubePlayer } from "./youtube-player";

const VIDEO_ID = /^[\w-]{11}$/;

/** 从各种形态的 YouTube 链接里抠出 videoId */
function extractVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // 直接贴 videoId 也认
  if (VIDEO_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  const candidate =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com"
        ? url.pathname === "/watch"
          ? (url.searchParams.get("v") ?? "")
          : /^\/(embed|shorts|live|v)\//.test(url.pathname)
            ? url.pathname.split("/")[2]
            : ""
        : "";

  const id = (candidate ?? "").split("/")[0];
  return VIDEO_ID.test(id) ? id : null;
}

export const youtubeAdapter: SourceAdapter = {
  kind: "youtube",

  parse(input: string): ParsedSource | null {
    const externalId = extractVideoId(input);
    if (!externalId) return null;
    return { externalId, url: `https://www.youtube.com/watch?v=${externalId}` };
  },

  // 标题走 oEmbed：不需要 API key，也不吃 YouTube Data API 的配额。
  // 代价是 oEmbed 不给时长 —— 时长由播放器就绪后 getDuration() 回写（PATCH /api/sources/[id]）。
  async resolve({ externalId }): Promise<ResolvedMeta> {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${externalId}`,
    )}&format=json`;
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { title: null, durationS: null };
      const data = (await res.json()) as { title?: unknown };
      return {
        title: typeof data.title === "string" ? data.title : null,
        durationS: null,
      };
    } catch {
      // 取不到标题不算失败：视频照样能看，标题后面可以补
      return { title: null, durationS: null };
    }
  },

  Player: YouTubePlayer,
};

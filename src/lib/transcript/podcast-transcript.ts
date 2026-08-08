import "server-only";
import Parser from "rss-parser";
import { parseEpisodePointer } from "@/lib/sources/podcast";
import { parseCaptions } from "@/lib/captions";
import type { SourceRow } from "@/lib/types";
import type { TranscribeContext, TranscribeResult, TranscriptProvider } from "./types";

// M2b — 播客字幕的「白捡」通路：发布方在 RSS 里自带 `<podcast:transcript>` 标签的，
// 直接拉下来用，零成本零延迟、一步到 ready。排在 Whisper 前面（创始人要求先穷尽免费的）。
//
// 覆盖率约 1/8（2a 实测：8 个真实节目只有 1 个带），所以它撑不起主力，只当锦上添花：
// 命中就白赚，没命中（拉不到 / 没标签 / 解析为空）一律抛**普通 Error**，
// 让入口的 Provider 链落到下一个（DeepInfra Whisper），绝不抛 TranscribeError 把整条钉死。

interface TranscriptTag {
  url: string;
  type?: string;
  language?: string;
}

// rss-parser 默认不认命名空间标签，得显式登记；attr-only 的自闭合元素属性落在 `$` 里
const parser = new Parser({
  timeout: 10_000,
  headers: { "user-agent": "Fermata/1.0 (+podcast client)" },
  customFields: { item: [["podcast:transcript", "podcastTranscripts", { keepArray: true }]] },
});

function collectTags(item: unknown): TranscriptTag[] {
  const raw = (item as Record<string, unknown>)?.podcastTranscripts;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: TranscriptTag[] = [];
  for (const t of arr) {
    const attrs = ((t as { $?: Record<string, string> })?.$ ?? t) as Record<string, string>;
    if (attrs && typeof attrs.url === "string" && attrs.url) {
      out.push({ url: attrs.url, type: attrs.type, language: attrs.language });
    }
  }
  return out;
}

export const podcastTranscriptProvider: TranscriptProvider = {
  name: "podcast-transcript",

  supports(source: SourceRow) {
    if (source.kind !== "podcast") return false;
    // 有 feed（external_id 带 #）才谈得上回 feed 找标签；网页导入 / 音频直链（D25，不带 #）
    // 没 feed 可查，直接交给 Whisper
    const { feedUrl, guid } = parseEpisodePointer(source.external_id ?? "");
    return !!feedUrl && !!guid;
  },

  async transcribe({ source }: TranscribeContext): Promise<TranscribeResult> {
    const { feedUrl, guid } = parseEpisodePointer(source.external_id ?? "");
    if (!feedUrl || !guid) throw new Error("这条播客没有 feed 指针");

    const feed = await parser.parseURL(feedUrl); // 拉不动 / 不是 feed → 抛错 → 链落到 Whisper

    // 优先按 guid 精确对上这一集；guid 缺失时导入用过音频直链当身份，用 enclosure 兜；
    // 都对不上再退回最新一集（我们导入的多半就是它）
    const item =
      feed.items?.find((it) => typeof it.guid === "string" && it.guid === guid) ??
      feed.items?.find((it) => it.enclosure?.url === guid) ??
      feed.items?.[0];
    if (!item) throw new Error("feed 里对不上这一集");

    const tags = collectTags(item);
    if (tags.length === 0) throw new Error("这一集没有自带字幕（<podcast:transcript>）");

    // 挑一个我们现成解析器能吃的：SRT / VTT 优先（parseCaptions 直接认）
    const pick =
      tags.find((t) => /vtt|srt|subrip/i.test(t.type ?? "") || /\.(vtt|srt)(\?|$)/i.test(t.url)) ?? tags[0];

    const res = await fetch(pick.url, {
      headers: { "user-agent": "Fermata/1.0 (+podcast client)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`自带字幕拉不动（${res.status}）`);

    const segments = parseCaptions(await res.text());
    // 解析为空多半是 JSON 格式的 transcript（我们暂不认）—— 交给 Whisper，别硬塞空字幕
    if (segments.length === 0) throw new Error("自带字幕解析为空（可能是 JSON 格式）");

    return { segments, complete: true, lang: pick.language ?? null };
  },
};

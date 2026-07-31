import Parser from "rss-parser";
import type { ParsedSource, ResolvedMeta, SourceAdapter } from "./types";
import { SourceResolveError } from "./types";
import { PodcastPlayer } from "./podcast-player";
import {
  extractEpisodeFromHtml,
  extractFeedLink,
  lookupApple,
  normalizePageUrl,
  parseAppleUrl,
  readPageBody,
} from "./podcast-web";

// M1d — 播客 adapter。D2/D4：只存指针（feed + 这一集的 guid + 音频直链），
// 永不下载媒体 —— 播的就是发布方自己公开的 enclosure，跟任何播客客户端一样。
//
// 这一片是对 1a 抽象是否做对的检验：watch-stage / 悬浮球 / 点点条一个字都没改。

/** 直接贴音频文件的情况（有人就是有一条 mp3 直链） */
const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac)$/i;

/**
 * 兜底上限。正常情况下根本到不了 —— 见 readFeedHead：读到第一集就收手。
 * 留着是防"贴进来的根本不是 feed"，那时没有 `</item>` 可停，得有个刹车。
 */
const MAX_FEED_BYTES = 5_000_000;

/** RSS 用 <item>，Atom 用 <entry>。读到第一条结束标签就够了 */
const FIRST_ENTRY = [
  { close: "</item>", tail: "</channel></rss>" },
  { close: "</entry>", tail: "</feed>" },
];

/**
 * **只读到第一集为止**，不整份拉下来。
 *
 * 起因是踩了一脚真实的坑：Simplecast 上一档大节目的 feed 有 **18 MB**（几千集），
 * 整份 `res.text()` 再截断，等于先下载 18 MB、再从中间一刀切断 XML —— 解析必炸，
 * 用户看到的是"这条链接不是播客订阅源"，而它明明是。
 * 而 D4 的口径本来就是"最新一集"，第一条 item 之后的内容一个字都用不上。
 */
async function readFeedHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_FEED_BYTES);

  const decoder = new TextDecoder();
  let buf = "";
  let bytes = 0;
  try {
    while (bytes < MAX_FEED_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buf += decoder.decode(value, { stream: true });
      for (const { close, tail } of FIRST_ENTRY) {
        const end = buf.indexOf(close);
        // 把标签补齐再交给解析器，否则它拿到的是半截 XML
        if (end >= 0) return buf.slice(0, end + close.length) + tail;
      }
    }
  } finally {
    // 剩下的十几 MB 不要了，别让连接挂着
    void reader.cancel().catch(() => {});
  }
  return buf;
}

/**
 * external_id 的组合式写法：`<feed 地址>#<这一集的 guid>`。
 *
 * 为什么不是只存音频直链：M2 的字幕要走 feed 里的 `<podcast:transcript>` 标签，
 * 那时必须能**回到 feed**。而 sources 表只有 external_id / url 两个指针位，
 * url 得留给能播的音频直链 —— 于是把 feed 与 guid 一起编进 external_id，
 * M2 直接 split('#') 就能取回，不用加字段、不用跑迁移。
 */
export function episodePointer(feedUrl: string, guid: string): string {
  return `${feedUrl}#${guid}`;
}

/** M2 用得着：把上面那个组合指针拆回 feed 与 guid */
export function parseEpisodePointer(externalId: string): {
  feedUrl: string | null;
  guid: string | null;
} {
  const at = externalId.lastIndexOf("#");
  if (at < 0) return { feedUrl: null, guid: null };
  return { feedUrl: externalId.slice(0, at), guid: externalId.slice(at + 1) };
}

/** 已经自带协议头的（`ftp:`、`mailto:`、`javascript:`…）不能再往前贴 https:// */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function normalizeUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  // 只有"裸域名"才补 https://。少了这一步，`ftp://x/y.mp3` 会被拼成
  // `https://ftp://x/y.mp3` —— 解析得出来（host=ftp），于是一条 ftp 链接
  // 被当成合法订阅源收下，错误一路带到 resolve 才炸。
  const candidate = HAS_SCHEME.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * `itunes:duration` 有三种写法都合法：秒数、`mm:ss`、`hh:mm:ss`。
 * 认不出来就返回 null —— 播放器就绪后会用真实时长回写，不猜。
 */
export function parseItunesDuration(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const s = Number(value);
    return s > 0 ? s : null;
  }
  const parts = value.split(":").map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) {
    return null;
  }
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return seconds > 0 ? Math.round(seconds) : null;
}

/**
 * 站点是 https，音频直链却常有 http —— 浏览器会按混合内容直接掐掉，
 * 表现是"播放器在，一按没声音"。绝大多数播客 CDN 同时支持 https，
 * 所以这里统一升到 https；万一某个源不支持，报错点在播放而不是导入，好排查。
 */
function upgradeToHttps(url: string): string {
  return url.startsWith("http://") ? `https://${url.slice(7)}` : url;
}

const parser = new Parser({ timeout: 10_000 });

/** 列表里每条内容只有一行，标题得同时回答"哪个节目 / 哪一集" */
function joinTitle(episode: string | null, show: string | null): string | null {
  return [episode?.trim(), show?.trim()].filter(Boolean).join(" · ") || null;
}

/**
 * M3.6：从 feed 里榨一张封面（单集自己的优先，没有就用整档节目的）。
 * RSS 这块没有统一写法 —— `itunes:image` 是属性、`<image><url>` 是子节点，
 * 各家挑着用，所以逐个试、试不出来就 null（历史页会画占位块，不留空白格子）。
 * 只认 http(s)，免得把 data: 或相对路径塞进 <img src>。
 */
function pickImage(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (/^https?:\/\//i.test(s)) return upgradeToHttps(s);
  }
  return null;
}

async function get(url: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    // 有些托管方会挡掉没有 UA 的请求
    headers: { "user-agent": "Fermata/1.0 (+podcast client)", accept },
  });
  if (!res.ok) {
    throw new SourceResolveError(`这条链接打不开（${res.status}），检查一下再试`);
  }
  return res;
}

/** 从一条订阅源里取**最新一集**（D4/D23 的口径）。选集是 M7 的事 */
async function episodeFromFeed(feedUrl: string, xml: string): Promise<ResolvedMeta> {
  let feed: Awaited<ReturnType<Parser["parseString"]>>;
  try {
    feed = await parser.parseString(xml);
  } catch {
    throw new SourceResolveError(
      "这条链接不是播客订阅源（RSS）。在播客 App 里找「复制 RSS 地址」，或直接贴一条 .mp3 链接。",
    );
  }

  const item = feed.items?.[0];
  const audioRaw = item?.enclosure?.url;
  if (!item || !audioRaw) {
    throw new SourceResolveError("这个订阅源里没找到可播放的音频（没有 enclosure）");
  }
  const audio = upgradeToHttps(audioRaw);
  // guid 缺失就退回音频直链当身份 —— 同一集重复导入仍能被去重
  const guid = (typeof item.guid === "string" && item.guid.trim()) || audio;

  return {
    title: joinTitle(
      typeof item.title === "string" ? item.title : null,
      typeof feed.title === "string" ? feed.title : null,
    ),
    durationS: parseItunesDuration(item.itunes?.duration),
    // 单集自己的封面优先，退回整档节目的（M3.6 历史页那张方图）
    thumbUrl: pickImage(
      (item.itunes as { image?: unknown } | undefined)?.image,
      (feed.itunes as { image?: unknown } | undefined)?.image,
      feed.image?.url,
    ),
    externalId: episodePointer(feedUrl, guid),
    url: audio,
  };
}

async function fetchFeed(feedUrl: string): Promise<ResolvedMeta> {
  const res = await get(
    feedUrl,
    "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  );
  return episodeFromFeed(feedUrl, await readFeedHead(res));
}

export const podcastAdapter: SourceAdapter = {
  kind: "podcast",

  // 注意 registry 的询问顺序：YouTube 先问，所以 YT 链接轮不到这里。
  // 剩下的 http(s) 链接一律先收下 —— 到底是订阅源、单集网页还是音频直链，
  // 由 resolve 去分辨，那里能给出具体原因，比笼统一句"认不出来"有用。
  parse(input: string): ParsedSource | null {
    const url = normalizeUrl(input);
    if (!url) return null;
    const href = url.toString();
    return { externalId: href, url: href };
  },

  async resolve(parsed): Promise<ResolvedMeta> {
    const pageUrl = new URL(parsed.url);

    // ① 音频直链：没有 feed 可读，直接拿它当一集
    if (AUDIO_EXT.test(pageUrl.pathname)) {
      const audio = upgradeToHttps(parsed.url);
      const name = decodeURIComponent(new URL(audio).pathname.split("/").pop() ?? "");
      return {
        title: name.replace(AUDIO_EXT, "") || null,
        durationS: null, // 直链读不到元数据，播放器就绪后回写
        externalId: audio,
        url: audio,
      };
    }

    // ② Apple Podcasts 的分享链接 —— iPhone 上最常见的一种。
    // 它的页面是 JS 渲染的，扒 HTML 扒不到音频，只能走苹果的公开查询接口。
    const apple = parseAppleUrl(pageUrl);
    if (apple) {
      const { episode, feedUrl, tooOld } = await lookupApple(apple);
      if (episode?.audioUrl) {
        return {
          title: joinTitle(episode.title, episode.showTitle),
          durationS: episode.durationS,
          thumbUrl: pickImage(episode.artworkUrl),
          // 拿得到 feed 就仍按 D23 编成组合指针，M2 还能回到 feed 找字幕。
          // 苹果不给 feed 里的 guid，所以用它自己的 trackId，并标上来源免得跟真 guid 混淆
          externalId: feedUrl
            ? episodePointer(feedUrl, `apple:${episode.trackId ?? apple.episodeId}`)
            : episode.audioUrl,
          url: upgradeToHttps(episode.audioUrl),
        };
      }
      if (tooOld) {
        throw new SourceResolveError(
          "这一期太旧了，苹果的接口翻不到（它只回最近两百期）。贴这档节目的 RSS 地址就能导入。",
        );
      }
      // 贴的是节目主页（链接里没有 ?i=）→ 按老规矩取最新一集
      if (feedUrl) return fetchFeed(feedUrl);
      throw new SourceResolveError(
        "这条 Apple Podcasts 链接查不到内容。确认一下链接是不是完整的，或者贴这档节目的 RSS 地址。",
      );
    }

    // ③ 剩下的：可能是订阅源，也可能是一个单集网页
    const res = await get(
      parsed.url,
      "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
    );
    const contentType = res.headers.get("content-type") ?? "";
    const isHtml = /text\/html|application\/xhtml/i.test(contentType);

    if (!isHtml) {
      return episodeFromFeed(parsed.url, await readFeedHead(res));
    }

    // 网页：按 JSON-LD → og:audio → 页面声明的 RSS 依次试（见 podcast-web.ts）
    const html = await readPageBody(res);
    const episode = extractEpisodeFromHtml(html, parsed.url);
    if (episode) {
      const identity = normalizePageUrl(episode.canonicalUrl ?? parsed.url);
      return {
        title: joinTitle(episode.title, episode.showTitle),
        durationS: episode.durationS,
        thumbUrl: pickImage(episode.imageUrl),
        // 网页这一档没有 feed 可回，身份就用规范化后的页面地址（不带 # → M2 会知道
        // 这条源没有 feed 可查字幕，走 Whisper 那条 fallback）
        externalId: identity,
        url: upgradeToHttps(episode.audioUrl),
      };
    }

    const feedLink = extractFeedLink(html, parsed.url);
    if (feedLink) return fetchFeed(feedLink);

    throw new SourceResolveError(
      "这个页面里没找到能播的单集。如果它是节目主页，请打开**某一期**再复制链接；或者贴这档节目的 RSS 地址。",
    );
  },

  Player: PodcastPlayer,
};

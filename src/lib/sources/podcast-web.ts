// M1d-fix — 把「一个网页链接」变成「一集播客」。
//
// 起因是创始人的真实动作：从小宇宙复制的是**单集页面地址**
// （…/episode/69f3…?utm_source=rss），不是 RSS。而"先去找这档节目的 RSS 地址"
// 这一步，普通用户根本走不完 —— 用户手里能拿到的就是一条网页链接。
//
// 好消息是不用为每个站点写一套：单集页面普遍带着两种**标准**元数据 ——
//   ① schema.org 的 JSON-LD `PodcastEpisode`（最全：集名 + 节目名 + 音频 + 时长）
//   ② Open Graph 的 `og:audio`（只有音频 + 标题）
// 小宇宙两种都有。这里按①→②→③（页面声明的 RSS）的顺序试。
//
// **服务端专用**（会发网络请求、解析大段 HTML），别从客户端 import —— 见 D24。

/** 网页比 feed 小得多，读到这个数还没找到就是没有 */
const MAX_PAGE_BYTES = 1_000_000;

export interface WebEpisode {
  audioUrl: string;
  title: string | null;
  showTitle: string | null;
  durationS: number | null;
  /** 页面自称的规范地址。有就用它当身份，免得同一集因为跟踪参数不同被导入两遍 */
  canonicalUrl: string | null;
}

/** `PT1H2M3S` / `PT43M` → 秒。ISO 8601 的时长写法，JSON-LD 里的 timeRequired 用它 */
export function parseIsoDuration(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(raw.trim());
  if (!m) return null;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return s > 0 ? Math.round(s) : null;
}

/**
 * 去掉分享链接上的跟踪参数与锚点。
 * 同一集从不同入口分享过来（?utm_source=rss / ?si=… / #t=30），
 * 不做这一步就会被当成好几条内容各导入一遍。
 */
export function normalizePageUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return input;
  }
}

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "si",
  "spm",
  "share_source",
  "share_medium",
  "share_id",
  "from",
  "ref",
]);

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function unescapeHtml(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** 把一个标签里的属性拆成 map。属性顺序在真实网页里是乱的，不能按顺序写死正则 */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    out[m[1].toLowerCase()] = unescapeHtml(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function metaMap(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = a.property ?? a.name ?? a.itemprop;
    if (key && a.content) out[key.toLowerCase()] = a.content;
  }
  return out;
}

/** 在任意深度的 JSON-LD 里找出第一个 PodcastEpisode（可能裹在数组或 @graph 里） */
function findPodcastEpisode(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findPodcastEpisode(item);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && t.toLowerCase() === "podcastepisode")) {
    return obj;
  }
  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    const hit = findPodcastEpisode(obj[key]);
    if (hit) return hit;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 从一个网页里榨出「这一集」。榨不出来返回 null（那时再去找页面声明的 RSS） */
export function extractEpisodeFromHtml(html: string, pageUrl: string): WebEpisode | null {
  // ① schema.org JSON-LD —— 最全的一档
  for (const block of html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ) ?? []) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    let data: unknown;
    try {
      data = JSON.parse(unescapeHtml(body));
    } catch {
      continue; // 一段坏 JSON 不该毁掉整次导入
    }
    const ep = findPodcastEpisode(data);
    const media = ep?.associatedMedia as Record<string, unknown> | undefined;
    const audio =
      asString(media?.contentUrl) ?? asString(ep?.contentUrl) ?? asString(ep?.audio);
    if (ep && audio) {
      const series = ep.partOfSeries as Record<string, unknown> | undefined;
      return {
        audioUrl: absolute(audio, pageUrl) ?? audio,
        title: asString(ep.name),
        showTitle: asString(series?.name),
        durationS: parseIsoDuration(ep.timeRequired),
        canonicalUrl: asString(ep.url),
      };
    }
  }

  // ② Open Graph —— 只有音频和标题，但覆盖面广
  const meta = metaMap(html);
  const ogAudio = meta["og:audio:secure_url"] ?? meta["og:audio"] ?? meta["twitter:player:stream"];
  if (ogAudio) {
    const abs = absolute(ogAudio, pageUrl);
    if (abs) {
      return {
        audioUrl: abs,
        title: meta["og:title"] ?? null,
        showTitle: meta["og:site_name"] ?? null,
        durationS: null,
        canonicalUrl: meta["og:url"] ?? null,
      };
    }
  }

  return null;
}

/** ③ 页面按 W3C 惯例声明的订阅源：`<link rel="alternate" type="application/rss+xml">` */
export function extractFeedLink(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    if (!a.href) continue;
    const rel = (a.rel ?? "").toLowerCase();
    const type = (a.type ?? "").toLowerCase();
    if (rel.includes("alternate") && /rss|atom|xml/.test(type)) {
      return absolute(a.href, pageUrl);
    }
  }
  return null;
}

/** 读网页正文，带上限。JSON-LD / og 都在 <head> 附近，一兆足够有余 */
export async function readPageBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_PAGE_BYTES);
  const decoder = new TextDecoder();
  let buf = "";
  let bytes = 0;
  try {
    while (bytes < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buf += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return buf;
}

// ── Apple Podcasts ──────────────────────────────────────────────────────────
// iPhone 上最常见的一种分享链接，但它的页面是 JS 渲染的，扒 HTML 扒不到音频。
// 好在苹果有一个公开、免 key 的查询接口（iTunes Search API），
// 用它把「分享链接」换成「音频直链 + 这档节目的 RSS」。

export interface AppleEpisode {
  audioUrl: string | null;
  feedUrl: string | null;
  title: string | null;
  showTitle: string | null;
  durationS: number | null;
  trackId: string | null;
}

/** 认不认得出这是一条 Apple Podcasts 链接 */
export function parseAppleUrl(
  url: URL,
): { collectionId: string; episodeId: string | null } | null {
  if (!/(^|\.)podcasts\.apple\.com$/.test(url.hostname)) return null;
  const collectionId = /\/id(\d+)/.exec(url.pathname)?.[1];
  if (!collectionId) return null;
  const episodeId = url.searchParams.get("i");
  return { collectionId, episodeId: episodeId && /^\d+$/.test(episodeId) ? episodeId : null };
}

/** 苹果一次最多回 200 条，够翻到近一年的节目了 */
const APPLE_LIMIT = 200;

function toAppleEpisode(r: Record<string, unknown>): AppleEpisode {
  const ms = Number(r.trackTimeMillis);
  return {
    audioUrl: asString(r.episodeUrl),
    feedUrl: asString(r.feedUrl),
    title: asString(r.trackName),
    showTitle: asString(r.collectionName),
    durationS: Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null,
    trackId: r.trackId != null ? String(r.trackId) : null,
  };
}

export async function lookupApple(ids: {
  collectionId: string;
  episodeId: string | null;
}): Promise<{ episode: AppleEpisode | null; feedUrl: string | null; tooOld: boolean }> {
  // 关键一点（踩过）：**苹果不支持按单集 id 直接查** ——
  // `lookup?id=<单集id>` 一律回 0 条。只能查这档节目、带上 entity=podcastEpisode
  // 把最近若干集一起要回来，再自己按 trackId 挑。
  const endpoint =
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(ids.collectionId)}` +
    `&entity=podcastEpisode&limit=${APPLE_LIMIT}`;
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { episode: null, feedUrl: null, tooOld: false };
    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    const results = data.results ?? [];
    const feedUrl =
      asString(results.find((r) => asString(r.feedUrl))?.feedUrl as unknown) ?? null;

    if (!ids.episodeId) return { episode: null, feedUrl, tooOld: false };

    const hit = results.find(
      (r) => r.wrapperType === "podcastEpisode" && String(r.trackId) === ids.episodeId,
    );
    if (!hit) {
      // 这一期比苹果回给我们的窗口还老。**宁可报错也不能悄悄导入另一期** ——
      // 用户点的是具体某一集，给他别的那叫骗人。
      return { episode: null, feedUrl, tooOld: true };
    }
    return { episode: toAppleEpisode(hit), feedUrl, tooOld: false };
  } catch {
    return { episode: null, feedUrl: null, tooOld: false };
  }
}

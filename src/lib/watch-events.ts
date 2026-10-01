import { z } from "zod";

// M3.15 片 c0 —— 互动记录里「一件事」长什么样（D71，迁移 0012 `watch_events`）。
//
// **客户端和服务端共用这一份**：记录器（`lib/watch-recorder.ts`）照它造行，
// 互动记录和捕获轴照它算，`/api/watch-events` 照它的白名单收行。
// 两边各写一份白名单，迟早一边多认一种 kind、另一边悄悄拒收 —— 所以只许有这一份。
//
// D24：纯数据 + 纯函数，客户端要 import，**一行服务端依赖都不许有**。

// ── 词汇表 ──────────────────────────────────────────────────────────────

/**
 * 一行是哪一种事。**数据库里不加 check 约束**，白名单就在这儿 ——
 * 片 f 的回拨提示要加一种 kind，改这一行就够，不用再开迁移。
 */
export const WATCH_KINDS = ["play", "pause", "seek", "leave", "ask", "capture"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

/**
 * 跳转是怎么来的。**每颗会跳的 Fermata 控件都自报家门**，没报名的就只可能来自播放器自己（`player`）。
 * YouTube 是跨域 iframe，里面按了什么（进度条 / 方向键 / 章节）浏览器不给看 ——
 * 所以界面上只许写「在 YouTube 播放器上」，**不许写成「拖了进度条」**（那是编的）。
 */
export const SEEK_VIAS = [
  "player",
  "at_link",
  "back",
  "dots",
  "dots_nav",
  "caption",
  "step",
  "record",
  "card",
] as const;
export type SeekVia = (typeof SEEK_VIAS)[number];

/**
 * D63：这几种跳转**不撤**钉着的返回牌 —— 是我们的链接把人送走的，或者 ±N 秒在落点附近挪一下。
 * 其余（捕获轴的点和 ◀▶、字幕行、播放器自己）＝ 用户自己在重新导航，牌子该撤。
 * 和片 b 的行为一模一样，只是判据从 `ours` 这个布尔值换成了 `via` 这个名字。
 */
export const KEEPS_BACK_CARD: ReadonlySet<SeekVia> = new Set<SeekVia>([
  "at_link",
  "step",
  "back",
  "record",
  "card",
]);

// ── 界面上「不单列」的门槛（D71 时创始人没反对的默认，要改随时改）────────

/** 跳转距离小于这个不单列（他截图里 04:21→04:20 那种噪音） */
export const LIST_MIN_JUMP_S = 3;
/** 停住小于这个不单列 */
export const LIST_MIN_PAUSE_MS = 3000;
/** 离开页面小于这个不单列（切标签页一闪） */
export const LIST_MIN_LEAVE_MS = 3000;
/** 连按合成一条：两次跳转相隔不到这么久就并成「−5 秒 ×3」 */
export const MERGE_WITHIN_MS = 2000;

// ── 传输与读取的上限 ────────────────────────────────────────────────────

/** 一批最多几行 */
export const MAX_BATCH = 200;
/** 关页面那一批（keepalive）：浏览器给 keepalive 请求体的总额度只有 64KB，一行约 250 字节 */
export const KEEPALIVE_BATCH = 100;
/** 观看页首屏最多取最新的几行。数是「开工先量」第 4 条量出来的，见 M3.15-log 片 c0 */
export const READ_CAP = 2000;

// ── 形状 ────────────────────────────────────────────────────────────────

export interface WatchMeta {
  /** ±N 秒那一下是几秒（带正负号）—— 界面写「−5 秒 ×3」 */
  step?: number;
  /** 这一段是页面藏在后台时播的（后台听播客很常见）。照算，末尾标「（在后台）」 */
  bg?: true;
  /** 很长的一段播放被切成几截落库（浏览器崩了最多丢一截）。后面几截带这个，界面上并回一行 */
  cont?: true;
  /** 问答：这一问和上一问之间跳过（或这是这一次观看的第一问）—— 问答栏里 `@` 标注从这儿重新算 */
  reset?: true;
}

/** 一件事。时间单位：`fromS/toS` 是内容里的第几秒，`durMs` 是真实经过的毫秒 */
export interface WatchEvent {
  /** 浏览器生成。重发同一批不会存两遍（服务端按它去重） */
  id: string;
  /** 同一次打开观看页 = 同一个 visit（界面上的「9月11日 14:02 这一次」） */
  visitId: string;
  /** 这一次里的第几件事 —— **按开始的先后编号**（一段播放开始时就占号，结束时才落库） */
  seq: number;
  /** 这件事开始的时刻（浏览器的钟，只用来显示和分组） */
  at: string;
  kind: WatchKind;
  fromS: number | null;
  toS: number | null;
  durMs: number | null;
  /** 播放段的倍速 */
  rate: number | null;
  /** 只有 seek 有 */
  via: SeekVia | null;
  /** ask / capture 指向那一轮；因提问而停的那一段 pause 也指向它 */
  interruptId: string | null;
  meta: WatchMeta | null;
}

/** 数据库里那一行（`select WATCH_EVENT_COLUMNS` 回来的形状） */
export interface WatchEventRow {
  id: string;
  visit_id: string;
  seq: number;
  at: string;
  kind: string;
  from_s: number | null;
  to_s: number | null;
  dur_ms: number | null;
  rate: number | null;
  via: string | null;
  interrupt_id: string | null;
  meta: unknown;
}

export const WATCH_EVENT_COLUMNS =
  "id, visit_id, seq, at, kind, from_s, to_s, dur_ms, rate, via, interrupt_id, meta";

const isKind = (k: string): k is WatchKind => (WATCH_KINDS as readonly string[]).includes(k);
const isVia = (v: string): v is SeekVia => (SEEK_VIAS as readonly string[]).includes(v);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** 读的时候**宽进**：只挑认识的字段，别让将来多出来的一个键把整行判成坏的 */
function readMeta(raw: unknown): WatchMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const out: WatchMeta = {};
  if (typeof m.step === "number" && Number.isFinite(m.step)) out.step = m.step;
  if (m.bg === true) out.bg = true;
  if (m.cont === true) out.cont = true;
  if (m.reset === true) out.reset = true;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 库里读回来的一行 → 界面用的形状。
 * **不认识的 kind 直接丢**：将来的新 kind（片 f 的回拨提示）落到还没更新的页面上，不该把整栏拖崩。
 */
export function fromRow(r: WatchEventRow): WatchEvent | null {
  if (!isKind(r.kind)) return null;
  return {
    id: r.id,
    visitId: r.visit_id,
    seq: r.seq,
    at: r.at,
    kind: r.kind,
    fromS: num(r.from_s),
    toS: num(r.to_s),
    durMs: num(r.dur_ms),
    rate: num(r.rate),
    via: r.via && isVia(r.via) ? r.via : null,
    interruptId: r.interrupt_id,
    meta: readMeta(r.meta),
  };
}

/**
 * 迁移 0012 没跑、表还不存在时 Supabase 回的是哪种错：
 * PostgREST 在自己的 schema 缓存里找不到表 → `PGRST205`；直通到 Postgres → `42P01`。
 * **读和写两处都要认得出**：读的时候当"没有记录"，而不是把观看页整页拖成 500；
 * 写的时候告诉界面「存不上」是这个原因（D44：说得出是哪一种失败）。
 */
export function isMissingTableError(e: { code?: string } | null | undefined): boolean {
  return e?.code === "PGRST205" || e?.code === "42P01";
}

// ── 服务端收行时的白名单（写的时候**严进**）────────────────────────────

const seconds = z.number().min(0).max(24 * 3600).nullable();

export const watchMetaSchema = z
  .object({
    step: z.number().min(-3600).max(3600).optional(),
    bg: z.literal(true).optional(),
    cont: z.literal(true).optional(),
    reset: z.literal(true).optional(),
  })
  .strict();

export const watchEventSchema = z.object({
  id: z.string().uuid(),
  visitId: z.string().uuid(),
  seq: z.number().int().min(0).max(1_000_000),
  at: z.iso.datetime({ offset: true }),
  kind: z.enum(WATCH_KINDS),
  fromS: seconds,
  toS: seconds,
  // 离开页面可能一离开就是一整夜
  durMs: z.number().int().min(0).max(7 * 24 * 3600 * 1000).nullable(),
  rate: z.number().min(0.0625).max(16).nullable(),
  via: z.enum(SEEK_VIAS).nullable(),
  interruptId: z.string().uuid().nullable(),
  meta: watchMetaSchema.nullable(),
});

export const watchBatchSchema = z.object({
  sourceId: z.string().uuid(),
  events: z.array(watchEventSchema).min(1).max(MAX_BATCH),
});

// ── 看了几遍：捕获轴的填色和互动记录顶上那条，**同一个函数算** ──────────────

export interface Span {
  fromS: number;
  toS: number;
}

/** 算「看了几遍」要的全部原料：已经落定的播放段 + 正在长的那一段 */
export interface CoverageSnap {
  plays: readonly Span[];
  open: Span | null;
}

/** 捕获轴只认这个接口，不认识记录器 —— 手机上不传它，轴就还是那根 1px 的线 */
export interface CoverageSource {
  subscribe(cb: () => void): () => void;
  getCoverage(): CoverageSnap;
}

/** 从 `from` 到 `to` 这一截被看了 `n` 遍。相邻同遍数的已经并好了 */
export interface CoverageSeg {
  from: number;
  to: number;
  n: number;
}

/**
 * 把一段段播放叠起来，数每一截被看了几遍。**照实算，不抹小缝**：
 * 10 秒的小跳过在 45 分钟的片子上就是约 2px 的一道缝，照画 —— 抹平等于替用户撒谎（D71）。
 * 结果覆盖整个 `[0, 时长]`（没看过的那几截 `n = 0`）。
 */
export function coverageSegments(snap: CoverageSnap, durationS: number): CoverageSeg[] {
  const total = durationS;
  if (!(total > 0)) return [];
  const marks: [number, number][] = [];
  const add = (s: Span) => {
    const a = Math.min(total, Math.max(0, s.fromS));
    const b = Math.min(total, Math.max(0, s.toS));
    if (b - a >= 0.05) marks.push([a, 1], [b, -1]);
  };
  for (const s of snap.plays) add(s);
  if (snap.open) add(snap.open);
  marks.sort((x, y) => x[0] - y[0]);

  const out: CoverageSeg[] = [];
  const push = (from: number, to: number, n: number) => {
    if (to - from <= 0) return;
    const last = out[out.length - 1];
    if (last && last.n === n) last.to = to;
    else out.push({ from, to, n });
  };
  let n = 0;
  let pos = 0;
  for (const [p, d] of marks) {
    push(pos, p, n);
    if (p > pos) pos = p;
    n += d;
  }
  push(pos, total, n);
  return out;
}

/** 三档就够：8px 的轨上第四档人眼分不出（D71） */
export function coverageTier(n: number): 0 | 1 | 2 | 3 {
  if (n <= 0) return 0;
  if (n >= 3) return 3;
  return n === 1 ? 1 : 2;
}

export interface CoverageSummary {
  watchedS: number;
  pct: number;
  /** 回看最多的那一截（至少看了 2 遍），没有就是 null */
  most: CoverageSeg | null;
  /** D66 口径的「跳过」：连续没看超过全片 1/10，而且在他已经看到过的地方之前 */
  skipped: CoverageSeg[];
}

/** 「回看最多」至少要这么长 —— 3 秒的五遍不如三分钟的四遍值得说 */
const MOST_MIN_S = 5;

export function coverageSummary(segs: readonly CoverageSeg[], durationS: number): CoverageSummary {
  let watchedS = 0;
  let furthest = 0;
  let most: CoverageSeg | null = null;
  for (const s of segs) {
    if (s.n < 1) continue;
    const len = s.to - s.from;
    watchedS += len;
    furthest = Math.max(furthest, s.to);
    if (s.n >= 2 && len >= MOST_MIN_S) {
      if (!most || s.n > most.n || (s.n === most.n && len > most.to - most.from)) most = s;
    }
  }
  // 后面还没播到的不叫「跳过」，那叫「还没看」—— 只列他已经看到过的地方之前的
  const skipped =
    durationS > 0
      ? segs.filter((s) => s.n === 0 && s.to <= furthest + 1e-6 && s.to - s.from > durationS / 10)
      : [];
  const pct = durationS > 0 ? Math.min(100, Math.round((watchedS / durationS) * 100)) : 0;
  return { watchedS, pct, most, skipped };
}

// ── 互动记录的一行一行（纯函数：原始事件进，界面上的行出）────────────────

/** 互动记录只要点的这几样 */
export interface PointLite {
  id: string;
  t_s: number;
  question: string | null;
  parent_id?: string | null;
  created_at?: string | null;
  /** 片 d 的另一半（D65）：问题分类，原样递过去（`interrupts.kinds`，读的地方过 `readKinds`） */
  kinds?: unknown;
}

interface PlayRow {
  kind: "play";
  key: string;
  fromS: number;
  toS: number;
  /** 「看了」＝ 内容时长（到 − 从），不是真实经过的时间（D71） */
  lenS: number;
  rate: number;
  bg: boolean;
  live: boolean;
}
interface PauseRow {
  kind: "pause";
  key: string;
  atS: number;
  durMs: number;
  live: boolean;
}
interface LeaveRow {
  kind: "leave";
  key: string;
  durMs: number;
  live: boolean;
}
interface SeekRow {
  kind: "seek";
  key: string;
  fromS: number;
  toS: number;
  via: SeekVia;
  /** 连按合成了几下 */
  n: number;
  step: number | null;
  /** 最后一下的时刻（毫秒）—— 合并时拿它和下一下比 */
  lastAt: number;
}
interface AskRow {
  kind: "ask";
  key: string;
  tS: number;
  interruptId: string;
  /** null = 这一问没答上（问题文字只在答完整时才落库） */
  question: string | null;
  /** 问完之后停了多久（因提问而停的不另起一行，挂在这一行末尾） */
  pauseMs: number;
  pauseLive: boolean;
}
interface CaptureRow {
  kind: "capture";
  key: string;
  tS: number;
  interruptId: string;
}
export type ActivityRow = PlayRow | PauseRow | LeaveRow | SeekRow | AskRow | CaptureRow;

export interface ActivityGroup {
  key: string;
  /** 这一组第一件事的时刻（ISO）；「更早」那一组是最早那个点的落库时刻 */
  startAt: string;
  /** 就是这一次打开观看页（组头写「这一次」） */
  current: boolean;
  /** 那时还没有观看记录：只有点和问题，没有播放 / 跳转 */
  earlier: boolean;
  rows: ActivityRow[];
}

/**
 * 原始事件 → 按「这一次打开观看页」分组的行。组按先后排，组内按真实先后（`seq`）。
 *
 * `liveId` 是正在进行的那一段（还没落库）的 id —— 它那一行每秒在长。
 * `capped` = 首屏读取被 `READ_CAP` 截过：那时分不清哪些点是「真没记过」、哪些是「被截掉了」，
 * 所以不放「更早」那一组，免得说错。
 */
export function buildActivity(
  events: readonly WatchEvent[],
  points: readonly PointLite[],
  currentVisit: string,
  liveId: string | null,
  capped = false,
): ActivityGroup[] {
  const pointById = new Map(points.map((p) => [p.id, p] as const));
  const asked = new Set<string>();
  const referenced = new Set<string>();
  const byVisit = new Map<string, WatchEvent[]>();
  for (const e of events) {
    if (e.interruptId && (e.kind === "ask" || e.kind === "capture")) {
      referenced.add(e.interruptId);
      if (e.kind === "ask") asked.add(e.interruptId);
    }
    const list = byVisit.get(e.visitId);
    if (list) list.push(e);
    else byVisit.set(e.visitId, [e]);
  }

  const groups: ActivityGroup[] = [];
  for (const [visitId, list] of byVisit) {
    list.sort((a, b) => a.seq - b.seq);
    const rows = rowsOfVisit(list, pointById, asked, liveId);
    if (rows.length === 0) continue;
    groups.push({ key: visitId, startAt: list[0].at, current: visitId === currentVisit, earlier: false, rows });
  }
  groups.sort((a, b) => a.startAt.localeCompare(b.startAt));

  // 上线之前就有的点和问题：库里知道「什么时候记的」，但那一次怎么播、怎么跳，没人记过 ——
  // 照实单放一组，写明「那时还没有观看记录」。不放的话，「全部」会比「只看提问」还少几条，看着像丢了。
  if (!capped) {
    const orphans = points
      .filter((p) => !p.id.startsWith("temp-") && !referenced.has(p.id))
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    if (orphans.length > 0) {
      groups.unshift({
        key: "earlier",
        startAt: orphans[0].created_at ?? "",
        current: false,
        earlier: true,
        rows: orphans.map<ActivityRow>((p) => {
          const q = (p.question ?? "").trim();
          return q
            ? { kind: "ask", key: `earlier-${p.id}`, tS: p.t_s, interruptId: p.id, question: q, pauseMs: 0, pauseLive: false }
            : { kind: "capture", key: `earlier-${p.id}`, tS: p.t_s, interruptId: p.id };
        }),
      });
    }
  }
  return groups;
}

function rowsOfVisit(
  list: readonly WatchEvent[],
  points: ReadonlyMap<string, PointLite>,
  asked: ReadonlySet<string>,
  liveId: string | null,
): ActivityRow[] {
  const raw: ActivityRow[] = [];
  const askPause = new Map<string, { ms: number; live: boolean }>();

  for (const e of list) {
    const live = e.id === liveId;
    if (e.kind === "play") {
      const fromS = e.fromS ?? 0;
      const toS = Math.max(fromS, e.toS ?? fromS);
      // 「看了多久」按**屏幕上那两个时间**算（mm:ss 一律往下取整）：写着「00:00 → 00:03」就是「看了 3 秒」。
      // lab 页上真出现过「00:00 → 00:03 · 看了 4 秒」（实际 3.9 秒、四舍五入）—— 人一减就对不上
      const lenS = Math.max(0, Math.floor(toS) - Math.floor(fromS));
      raw.push({ kind: "play", key: e.id, fromS, toS, lenS, rate: e.rate ?? 1, bg: Boolean(e.meta?.bg), live });
    } else if (e.kind === "pause") {
      const ms = e.durMs ?? 0;
      if (e.interruptId) {
        // 因提问而停的不另起一行 —— 停了多久挂在那一行「?」的末尾（D71）
        const cur = askPause.get(e.interruptId);
        askPause.set(e.interruptId, { ms: (cur?.ms ?? 0) + ms, live: Boolean(cur?.live) || live });
      } else if (ms >= LIST_MIN_PAUSE_MS) {
        raw.push({ kind: "pause", key: e.id, atS: e.fromS ?? 0, durMs: ms, live });
      }
    } else if (e.kind === "leave") {
      const ms = e.durMs ?? 0;
      if (ms >= LIST_MIN_LEAVE_MS) raw.push({ kind: "leave", key: e.id, durMs: ms, live });
    } else if (e.kind === "seek") {
      pushSeek(raw, e);
    } else if (e.kind === "ask" && e.interruptId) {
      const p = points.get(e.interruptId);
      // 那一轮删掉了（D62：删点 = 删那一轮；库里这一行也跟着 cascade 走了）
      if (!p) continue;
      const q = (p.question ?? "").trim();
      raw.push({ kind: "ask", key: e.id, tS: e.toS ?? p.t_s, interruptId: e.interruptId, question: q || null, pauseMs: 0, pauseLive: false });
    } else if (e.kind === "capture" && e.interruptId) {
      const p = points.get(e.interruptId);
      // 同一个点后来被问过 → 那一行「?」就代表它，别再多一行「记了一个点」
      if (!p || asked.has(e.interruptId) || (p.question ?? "").trim()) continue;
      raw.push({ kind: "capture", key: e.id, tS: e.toS ?? p.t_s, interruptId: e.interruptId });
    }
  }

  // 第二遍：丢掉合并完仍然很短的跳转、零碎的播放段，再把接得上的播放段并成一行
  const out: ActivityRow[] = [];
  for (const r of raw) {
    if (r.kind === "seek" && Math.abs(r.toS - r.fromS) < LIST_MIN_JUMP_S) continue;
    if (r.kind === "play" && r.lenS < 1 && !r.live) continue;
    const prev = out[out.length - 1];
    // 跳完之后从哪儿接着播，才是真正的落点：YouTube 会落到最近的关键帧上，比目标早零点几秒
    // （lab 页上见过「→ 15:14」下一行却是「15:13 → …」）。差不到 3 秒就以真正开播的地方为准
    if (r.kind === "play" && prev?.kind === "seek" && Math.abs(r.fromS - prev.toS) < LIST_MIN_JUMP_S) {
      prev.toS = r.fromS;
    }
    if (
      r.kind === "play" &&
      prev?.kind === "play" &&
      prev.bg === r.bg &&
      prev.rate === r.rate &&
      Math.abs(r.fromS - prev.toS) < LIST_MIN_JUMP_S
    ) {
      prev.toS = r.toS;
      prev.lenS += r.lenS;
      prev.live = prev.live || r.live;
      continue;
    }
    out.push(r);
  }
  for (const r of out) {
    if (r.kind !== "ask") continue;
    const p = askPause.get(r.interruptId);
    if (p) {
      r.pauseMs = p.ms;
      r.pauseLive = p.live;
    }
  }
  return out;
}

/** 连按 ±N 秒 / 连点 ◀▶ / 在播放器上来回拖：两下相隔不到 2 秒的并成一行（D71） */
function pushSeek(raw: ActivityRow[], e: WatchEvent) {
  const fromS = e.fromS ?? 0;
  const toS = e.toS ?? fromS;
  const via = e.via ?? "player";
  const step = e.meta?.step ?? null;
  const at = Date.parse(e.at);
  // 往回找上一次跳转，跨过中间那几截零碎的播放 —— 边播边连按时，两下之间会播个零点几秒
  let i = raw.length - 1;
  while (i >= 0) {
    const r = raw[i];
    if (r.kind === "play" && r.lenS < 2 && !r.live) i -= 1;
    else break;
  }
  const prev = raw[i];
  if (prev?.kind === "seek" && prev.via === via && prev.step === step && at - prev.lastAt <= MERGE_WITHIN_MS) {
    raw.splice(i + 1);
    prev.toS = toS;
    prev.n += 1;
    prev.lastAt = at;
    return;
  }
  raw.push({ kind: "seek", key: e.id, fromS, toS, via, n: 1, step, lastAt: at });
}

/** 「只看提问」：所有问过的问题按先后排，追问缩进（原来「问题列表」那一栏的样子） */
export interface QuestionItem {
  id: string;
  tS: number;
  question: string;
  followUp: boolean;
  /** 什么时候问的（`interrupts.created_at`）—— 「按提问先后」分段、段头的日期时间都用它 */
  at: string | null;
  /**
   * 片 d 的另一半（D65）：这一问的分类，**原样**（没过 `readKinds`）——
   * 这份列表每多一个点就整个重算一遍，原样递下去，标签那一格才认得出「这一问的标签其实没变」
   */
  kinds: unknown;
}

export function questionList(points: readonly PointLite[]): QuestionItem[] {
  return points
    .filter((p) => (p.question ?? "").trim() && !p.id.startsWith("temp-"))
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
    .map((p) => ({
      id: p.id,
      tS: p.t_s,
      question: (p.question ?? "").trim(),
      followUp: Boolean(p.parent_id),
      at: p.created_at ?? null,
      kinds: p.kinds ?? null,
    }));
}

/** 屏幕上的同一个 mm:ss（往下取整）—— 两种排法认「同一个时间点」用同一条口径 */
const momentOf = (tS: number) => Math.max(0, Math.floor(tS));

/** 「只看提问」的一组：同一个时间点问过的所有问题 */
export interface QuestionMoment {
  /** 这一组的时间（整秒，和屏幕上的 mm:ss 同一个口径：往下取整） */
  tS: number;
  /** 按提问先后排，**平铺**（D72：不再按追问缩进） */
  items: QuestionItem[];
}

/**
 * 「只看提问」按**时间点**分组（D72，创始人 2026-09-13：「应该并列，只要是在同一个时间点」）。
 *
 * 片 c0 按提问先后排、追问缩进 —— 他真机上看到同一个 @01:32 底下挂出两层：先问两句、往后看了一会、
 * 回到 01:32 又问三句，于是成了「两个母问题各带几个子问题」。在他眼里这五句是**同一个时刻问的五个问题，地位一样**。所以：
 * ① 同一秒（屏幕上显示成同一个 mm:ss）的问题归成一组，组里平铺、按提问先后排；
 * ② 组与组按**视频里的时间**排 —— 这一栏回答的是「我在哪几个地方停下来问过什么」；
 *    按真实先后发生的完整经过在「全部」里，那一栏一行都没动。
 * `parent_id` 照旧落库、照旧有用（「问了几个回合才接着看」那份数据），只是不再画成层级。
 */
export function questionMoments(points: readonly PointLite[]): QuestionMoment[] {
  const byS = new Map<number, QuestionItem[]>();
  for (const q of questionList(points)) {
    const k = momentOf(q.tS);
    const list = byS.get(k);
    if (list) list.push(q);
    else byS.set(k, [q]);
  }
  return [...byS.entries()].sort((a, b) => a[0] - b[0]).map(([tS, items]) => ({ tS, items }));
}

/**
 * 「只看提问 · 按提问先后」里，隔了多久没问就另起一段（段头写那一刻的日期时间）。
 * 他 2026-09-18 的原话：「1:33 那两个问题其实是我在 1:34、2:55 后面问的，就是说我后面又回到了这个视频」——
 * 「后来又回来」要一眼看得出来，才分段。按真实间隔判，不按观看记录的「一次打开」判：
 * 片 c0 之前问的问题没有观看记录可对（`act.earlier` 那一组），这条规矩对新旧问题一视同仁。
 */
export const ASK_SESSION_GAP_MS = 30 * 60_000;

/** 「按提问先后」的一段：一次坐下来连着问的那几句 */
export interface QuestionSession {
  /** 这一段第一句的提问时刻（ISO）。没有的话（理论上不会）就是 null，段头不写时间 */
  at: string | null;
  /** 段里按提问先后排；**挨着的**几句同一个时间点归一串、时间只写一次（和「按视频时间」一个样子） */
  moments: QuestionMoment[];
}

/**
 * 「只看提问」按**提问的真实先后**排（D74，2026-09-18 创始人：两种顺序都有用，给一个开关，**默认就是这一种**）。
 *
 * 「按视频时间」（D72，`questionMoments`）回答的是「我在视频的哪几处停下来问过什么」—— 同一个时间点的全摞在一起，
 * 哪怕是隔天回来问的；这一种回答的是「我是按什么顺序问的」：回到 01:33 又问的那两句，排在 01:34、02:55 后面。
 * 同一个时间点**隔开问**的（先问 00:11、再问 02:55、又回到 00:11）在这里是两串 —— 那正是他问的顺序，不合并。
 */
export function questionSessions(points: readonly PointLite[], gapMs = ASK_SESSION_GAP_MS): QuestionSession[] {
  const out: QuestionSession[] = [];
  let lastMs = -Infinity;
  for (const q of questionList(points)) {
    const ms = q.at ? Date.parse(q.at) : NaN;
    let session = out[out.length - 1];
    // 头一句、或者离上一句超过 gapMs：另起一段。取不到时间的就跟着上一段走，不凭空断开
    if (!session || (Number.isFinite(ms) && ms - lastMs > gapMs)) {
      session = { at: q.at, moments: [] };
      out.push(session);
    }
    if (Number.isFinite(ms)) lastMs = ms;
    const last = session.moments[session.moments.length - 1];
    if (last && last.tS === momentOf(q.tS)) last.items.push(q);
    else session.moments.push({ tS: momentOf(q.tS), items: [q] });
  }
  return out;
}

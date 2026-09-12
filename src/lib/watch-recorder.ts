import {
  KEEPALIVE_BATCH,
  LIST_MIN_JUMP_S,
  MAX_BATCH,
  type CoverageSnap,
  type CoverageSource,
  type SeekVia,
  type Span,
  type WatchEvent,
  type WatchMeta,
} from "@/lib/watch-events";

// M3.15 片 c0 —— 互动记录的**记录器**（D71）。只在浏览器里用。
//
// 播放器只会说三件事：「在播 / 没在播」「用户按了暂停」「现在第几秒」。
// 这里把它们拼成一行一行的事 —— 播了一段、停住、离开页面、跳、问、记点 —— 按真实先后，一件不漏。
// **它是 `watch_events` 那张表唯一的写手**，捕获轴的填色和互动记录都从它读。
//
// ── 为什么是一个普通的类，不是 React state ────────────────────────────
// 250ms 那一轮每秒来 4 次，进 React state 就是每秒整页重渲染 4 次（M0.5 栽过）。
// 所以它自己记账，只有**订了它的那两小块**（捕获轴的填色、互动记录那一栏）最多每秒被叫醒一次
// （`subscribe` + `useSyncExternalStore`）。手机上一个订户都没有 —— 照记、不显示、
// 页面一次都不多渲染（D71：手机照记不显示）。
//
// ── 三条从实测里来的规矩（开工先量第 5、6 条，2026-09-12） ────────────
// ① **「停住」只认「用户按了暂停」**（`onPause`），不认「没在播」：YouTube 每跳一次都会先报一下
//    BUFFERING（实测约 0.6 秒的"没在播"），拿它当暂停，每次跳转都会多出一行假的「停住」。
// ② **判跳转不能拿「两轮之间差几秒」和固定门槛比**：后台标签页里这一轮会被浏览器限速 ——
//    Chrome 藏起来 5 分钟后一分钟才来一次，Safari 干脆冻住（量到一口气 228 秒没来）。
//    所以比的是「按真实经过的时间 × 倍速，本来最远能播到哪」（见 `tick`）。
// ③ **YouTube 的 seekTo 是异步的**：我们刚让它跳，下一轮读到的可能还是旧位置。
//    自报的跳转先挂成 `pending`，等播放器真的落地了才算数，中间读到的旧位置不许记成「又跳回去了」。

/** 播放器上小于这么多秒的跳和正常播放分不开 —— 只认得出比它大的。Fermata 控件自报的不受这个限 */
const SEEK_EPS_S = 2.5;
/** 我们刚发起的那一跳，最多等播放器这么久落地 */
const PENDING_MS = 3000;
/** 没在播、又没收到「用户按了暂停」超过这么久 —— 播完了 / 卡死了，那一段就此收口 */
const STALL_MS = 3000;
/** 多久往服务器送一批 */
const FLUSH_EVERY_MS = 30_000;
/** 一段连着播超过这么久就先切一截落库 —— 浏览器崩了最多丢这么多 */
const CHECKPOINT_MS = 5 * 60_000;
/** 正在进行的那一段，最多每秒通知订户一次（捕获轴「边看边长」的节奏，D71：1–2 秒一次） */
const LIVE_NOTIFY_MS = 1000;
/** 比这短的停 / 离开是状态抖动（缓冲、切标签页一闪），不值一行 */
const MIN_SPAN_MS = 500;

type OpenKind = "play" | "pause" | "leave";

/** 正在进行、还没收口的那一段。**同一时刻最多一段** */
interface OpenSpan {
  kind: OpenKind;
  id: string;
  /** 开始时就占好的号 —— 行按「开始的先后」排，不按「结束的先后」 */
  seq: number;
  startAt: number;
  fromS: number;
  toS: number;
  /** 播放头最后一次往前走的时刻。播放段的 `durMs` 算到这儿，不算到收口那一刻（卡住的那几秒不算看） */
  lastAdvanceAt: number;
  rate: number;
  bg: boolean;
  interruptId: string | null;
  cont: boolean;
}

/** 存不上是哪一种（D44：说得出是哪一种失败）。null = 没问题 */
export type SaveTrouble = "network" | "server" | "auth" | "missing" | null;

/** 互动记录那一栏要的全部东西 */
export interface RecorderLive {
  /** 已经收口的（以前几次观看的 + 这一次的） */
  events: readonly WatchEvent[];
  /** 正在进行的那一段，materialize 成一行（它每秒在长） */
  open: WatchEvent | null;
  /** 还没存上的行数 */
  unsaved: number;
  trouble: SaveTrouble;
  /** 服务端说格式不对、丢掉了的行数（那是程序的错，得说出来） */
  dropped: number;
}

type NewEvent = Omit<WatchEvent, "id" | "visitId" | "seq"> & { id?: string; seq?: number };

const iso = (ms: number) => new Date(ms).toISOString();

export class WatchRecorder implements CoverageSource {
  readonly visitId: string;
  private readonly sourceId: string;
  private seq = 0;
  private closed: readonly WatchEvent[];
  private closedPlays: readonly Span[];
  private resets: ReadonlySet<string>;
  private unsent: WatchEvent[] = [];
  private open: OpenSpan | null = null;
  private playing = false;
  private hidden = false;
  private pos = 0;
  private posAt = 0;
  private initialized = false;
  private rate: number;
  private stallSince: number | null = null;
  private pending: { from: number; to: number; at: number } | null = null;
  /** 刚问完的那一轮：接下来的「停住」算在它头上（「?」那一行末尾的「停了 X」） */
  private askAttr: string | null = null;
  /** 上一问之后跳过没有（问答栏 `@` 标注从哪儿重新算）。这一次观看的第一问算"跳过" */
  private seekSinceAsk = true;
  private trouble: SaveTrouble = null;
  private dropped = 0;
  /** 再也不送了：表不存在（迁移 0012 没跑）/ 这条内容已经删了 */
  private stopped = false;
  private inFlight = false;
  private again = false;
  private lastLiveNotify = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<() => void>();
  private liveSnap: RecorderLive;
  private coverSnap: CoverageSnap;

  constructor(opts: {
    sourceId: string;
    /** 以前几次观看的（观看页服务端取的） */
    initial: readonly WatchEvent[];
    /** 用户选的倍速（播放器每次就绪都按它重设） */
    rate?: number;
    /** 观看页读的时候就发现表不存在 —— 一次都别送 */
    missingTable?: boolean;
  }) {
    this.visitId = crypto.randomUUID();
    this.sourceId = opts.sourceId;
    this.rate = opts.rate && opts.rate > 0 ? opts.rate : 1;
    this.closed = opts.initial;
    this.closedPlays = opts.initial.flatMap((e) =>
      e.kind === "play" && e.fromS != null && e.toS != null ? [{ fromS: e.fromS, toS: e.toS }] : [],
    );
    this.resets = new Set(
      opts.initial.flatMap((e) => (e.kind === "ask" && e.meta?.reset && e.interruptId ? [e.interruptId] : [])),
    );
    if (opts.missingTable) {
      this.stopped = true;
      this.trouble = "missing";
    }
    this.liveSnap = { events: this.closed, open: null, unsaved: 0, trouble: this.trouble, dropped: 0 };
    this.coverSnap = { plays: this.closedPlays, open: null };
  }

  // ── 给 React 的（`useSyncExternalStore`）：箭头函数，身份永远不变 ──────────

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getLive = (): RecorderLive => this.liveSnap;
  getCoverage = (): CoverageSnap => this.coverSnap;
  /** 哪几轮问答的 `@` 标注要从头算（这一问之前跳过）。只在多了一问时才换一个新的 Set */
  getLabelResets = (): ReadonlySet<string> => this.resets;
  /** 现在问一句的话，算不算"跳过之后" —— 问答栏里正在飞、还没落库的那一轮用 */
  peekReset = (): boolean => this.seekSinceAsk;

  // ── 生命周期 ──────────────────────────────────────────────────────────

  /** 在 effect 里调（构造函数会在服务端渲染时跑一遍，那儿没有 document） */
  start() {
    if (this.timer != null) return;
    this.hidden = document.visibilityState === "hidden";
    this.timer = setInterval(() => void this.flush(), FLUSH_EVERY_MS);
  }

  /** 真的离开这一页（换路由 / 卸载）：收口 + 能送就送 */
  stop() {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.closeOpen(Date.now());
    void this.flush({ keepalive: true });
  }

  /** 关标签页 / 手机切走（`pagehide`）。页面还可能从 bfcache 里回来，所以不拆定时器 */
  pageHide() {
    this.closeOpen(Date.now());
    // 回来时第一轮重新对表 —— 别把"关着的那段时间播放头没动"算成一次跳转
    this.initialized = false;
    void this.flush({ keepalive: true });
  }

  // ── 播放器告诉我们的三件事 ────────────────────────────────────────────

  /** 在播 / 没在播（YouTube 缓冲、播完也会报"没在播"，所以这里**不**当成暂停） */
  onPlaying(next: boolean, t: number, now = Date.now()) {
    this.playing = next;
    if (next) {
      this.stallSince = null;
      if (this.open?.kind === "play") return; // 缓冲完了接着播，还是同一段
      this.closeOpen(now);
      this.askAttr = null;
      // YouTube 报「开始播了」的时候，画面往往已经走了零点几秒（lab 页上实测：每次续播差约 0.25 秒）。
      // 拿那一刻的读数当起点，停住和续播之间就会凭空多出一道「没看过」的缝 —— 那是量错了，不是跳过。
      // 读数只比停住的地方靠前一点点（还不够认成一次跳转）→ 起点就是停住的地方
      const from = t >= this.pos && t - this.pos < SEEK_EPS_S ? this.pos : t;
      this.openSpan("play", now, from);
      this.notify(now);
    } else if (this.open?.kind === "play" && this.stallSince == null) {
      // 可能只是缓冲 —— 等「用户按了暂停」，或者卡太久了再收口（见 settle）
      this.stallSince = now;
    }
  }

  /** 用户真的按了暂停（YouTube 的 PAUSED / `<audio>` 的 pause，播完那一下不算） */
  onPause(t: number, now = Date.now()) {
    this.stallSince = null;
    // YouTube 在暂停状态下跳完会再报一次 PAUSED —— 已经停着了，别另起一段
    if (this.open && this.open.kind !== "play") return;
    if (this.open?.kind === "play") {
      this.extendOpen(t, now);
      this.closeOpen(now);
    }
    // 藏在后台时停住的 = 「离开页面」，不算停留（去倒水那几分钟不许算进「停了多久」，D71）
    this.openSpan(this.hidden ? "leave" : "pause", now, t, {
      interruptId: this.hidden ? null : this.askAttr,
    });
    this.notify(now);
  }

  /** 页面藏起来 / 回来 */
  onVisibility(hidden: boolean, t: number, now = Date.now()) {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    const o = this.open;
    if (o?.kind === "play") {
      // 还在播：同一次播放，从这一刻起换成「在后台」/ 回到前台 —— 切成两段，末尾那个标记才说得准
      this.extendOpen(t, now);
      this.closeOpen(now);
      this.openSpan("play", now, o.toS);
    } else if (o?.kind === "pause" && hidden) {
      this.closeOpen(now);
      this.openSpan("leave", now, o.fromS);
    } else if (o?.kind === "leave" && !hidden) {
      this.closeOpen(now);
      this.openSpan("pause", now, o.fromS, { interruptId: this.askAttr });
    }
    this.notify(now);
    // 藏起来的页面随时可能被系统收掉 —— 趁现在把手里的送出去
    if (hidden) void this.flush({ keepalive: true });
  }

  /** 倍速变了：播放段一段只有一个倍速，所以切一刀 */
  setRate(r: number, t: number, now = Date.now()) {
    if (!(r > 0) || Math.abs(r - this.rate) < 0.01) return;
    const o = this.open;
    if (o?.kind === "play") {
      this.extendOpen(t, now);
      this.closeOpen(now);
      this.rate = r;
      this.openSpan("play", now, o.toS);
      this.notify(now);
    } else {
      this.rate = r;
    }
  }

  /**
   * 250ms 那一轮每次都来。
   * 返回 true = 刚认出一次**播放器自己**的跳转（没有任何 Fermata 控件报过名）——
   * 调用方拿它撤 D63 钉着的返回牌（用户自己在播放器上跳 = 他知道自己在干嘛）。
   */
  tick(t: number, now = Date.now()): boolean {
    if (!Number.isFinite(t)) return false;
    if (!this.initialized) {
      this.initialized = true;
      this.pos = t;
      this.posAt = now;
      return false;
    }
    const p = this.pending;
    if (p) {
      if (now - p.at > PENDING_MS) this.pending = null;
      else if (Math.abs(t - p.to) < SEEK_EPS_S) {
        this.pending = null;
        return this.settle(t, now);
      } else if (Math.abs(t - p.from) < SEEK_EPS_S) {
        this.posAt = now; // 播放器还没挪过去，这一轮读到的是旧位置 —— 不算，也不许拿它去长那一段
        return false;
      } else this.pending = null;
    }
    // ── 播放头是自己走过来的，还是被扔过来的（见文件顶上 ②）──
    const elapsedS = Math.max(0, (now - this.posAt) / 1000);
    const ahead = (this.open?.kind === "play" ? elapsedS * this.rate : 0) + SEEK_EPS_S;
    if (t > this.pos + ahead || t < this.pos - SEEK_EPS_S) {
      this.playerSeek(this.pos, t, now);
      this.pos = t;
      this.posAt = now;
      return true;
    }
    return this.settle(t, now);
  }

  private settle(t: number, now: number): boolean {
    this.pos = t;
    this.posAt = now;
    this.extendOpen(t, now);
    // 在播却没有打开的段（从 bfcache 回来、或者播放器没报状态就动了）—— 补上
    if (this.playing && !this.open && this.stallSince == null) {
      this.openSpan("play", now, t);
      this.notify(now);
      return false;
    }
    // 卡太久了（播完了 / 网断了）：那一段收口在播放头最后一次往前走的地方
    if (this.stallSince != null && this.open?.kind === "play" && now - this.stallSince > STALL_MS) {
      this.closeOpen(now);
      this.stallSince = null;
      this.notify(now);
      return false;
    }
    if (this.open && now - this.lastLiveNotify >= LIVE_NOTIFY_MS) this.notify(now);
    return false;
  }

  // ── Fermata 自己的动作 ──────────────────────────────────────────────────

  /** Fermata 的控件把播放头挪走了（自报家门，所以知道是怎么跳的） */
  seek(via: SeekVia, fromS: number, toS: number, step: number | null = null, now = Date.now()) {
    const was = this.open;
    if (was?.kind === "play") this.extendOpen(fromS, now);
    this.closeOpen(now);
    this.append({
      at: iso(now),
      kind: "seek",
      fromS,
      toS,
      durMs: null,
      rate: null,
      via,
      interruptId: null,
      meta: step != null ? { step } : null,
    });
    this.afterJump(was, toS, now);
    this.pending = { from: fromS, to: toS, at: now };
    this.notify(now);
  }

  /** `?t=` 进来的那一跳：不是用户在这一页上干的，别记成一次跳转 */
  noteLanding(toS: number, now = Date.now()) {
    this.pending = { from: this.pos, to: toS, at: now };
  }

  /** 问了一句（这一轮已经落成捕获点了，D62）。**立刻送一批** —— 保证「先跳后问」的顺序落得住 */
  ask(interruptId: string, tS: number, now = Date.now()) {
    const reset = this.seekSinceAsk;
    this.seekSinceAsk = false;
    this.append({
      at: iso(now),
      kind: "ask",
      fromS: tS,
      toS: tS,
      durMs: null,
      rate: null,
      via: null,
      interruptId,
      meta: reset ? { reset: true } : null,
    });
    const o = this.open;
    if (o?.kind === "pause") {
      // 问之前停着的那一截照旧算「停住」；问之后停的这一截挂在这一问头上
      this.closeOpen(now);
      this.openSpan("pause", now, o.fromS, { interruptId });
    } else if (!o && !this.playing) {
      this.openSpan(this.hidden ? "leave" : "pause", now, tS, { interruptId: this.hidden ? null : interruptId });
    }
    // 还在播的话，问一句会让它停下来（D33）—— 接下来那一段「停住」也算这一问的
    this.askAttr = interruptId;
    this.notify(now);
    void this.flush();
  }

  /** 「只记下这一刻」（悬浮球 / 问答栏边上那颗按钮） */
  capture(interruptId: string, tS: number, now = Date.now()) {
    this.append({
      at: iso(now),
      kind: "capture",
      fromS: tS,
      toS: tS,
      durMs: null,
      rate: null,
      via: null,
      interruptId,
      meta: null,
    });
    this.notify(now);
    void this.flush();
  }

  // ── 送去存 ──────────────────────────────────────────────────────────────

  /**
   * 送一批去 `/api/watch-events`。**不花钱，所以存不上可以自己补**（D44 只禁止代码替人重试花钱的动作）：
   * 没送成的留在手里，`id` 是固定的，下一批一起再送，服务端按 `id` 去重 —— 库里不会多一行。
   * 但存不上的原因要说得出（D44 前半句）：互动记录那一栏顶上照实写。
   */
  async flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const o = this.open;
    if (o?.kind === "play" && now - o.startAt > CHECKPOINT_MS) {
      const at = o.toS;
      this.closeOpen(now);
      this.openSpan("play", now, at, { cont: true });
    }
    if (this.stopped || this.unsent.length === 0) return;
    // 关页面那一批不等前一批 —— 页面要没了。重复送到的服务端会忽略
    if (this.inFlight && !opts.keepalive) {
      this.again = true;
      return;
    }
    const batch = this.unsent.slice(0, opts.keepalive ? KEEPALIVE_BATCH : MAX_BATCH);
    this.inFlight = true;
    let trouble: SaveTrouble = null;
    let drain = false;
    try {
      const res = await fetch("/api/watch-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: this.sourceId, events: batch }),
        keepalive: opts.keepalive,
      });
      if (res.ok) {
        this.forget(batch);
        drain = this.unsent.length > 0;
      } else {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        if (res.status === 401) trouble = "auth";
        else if (res.status === 404) {
          // 这条内容已经删了：存不上，也不需要存了
          this.unsent = [];
          this.stopped = true;
        } else if (res.status === 400) {
          // 格式不对 = 程序的错。再送一百遍也是 400，只会把后面好的那些也堵死 —— 丢掉，并且说出来
          this.forget(batch);
          this.dropped += batch.length;
        } else if (body.code === "missing_table") {
          this.stopped = true;
          trouble = "missing";
        } else trouble = "server";
      }
    } catch {
      trouble = "network";
    } finally {
      this.inFlight = false;
    }
    this.trouble = trouble;
    this.notify();
    if (this.stopped) return;
    if (drain || (this.again && !trouble)) {
      this.again = false;
      void this.flush();
    }
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private playerSeek(fromS: number, toS: number, now: number) {
    const was = this.open;
    this.closeOpen(now);
    this.append({
      at: iso(now),
      kind: "seek",
      fromS,
      toS,
      durMs: null,
      rate: null,
      via: "player",
      interruptId: null,
      meta: null,
    });
    this.afterJump(was, toS, now);
    this.notify(now);
  }

  /** 跳完接着干刚才在干的事，只是换了个地方 */
  private afterJump(was: OpenSpan | null, toS: number, now: number) {
    this.askAttr = null;
    if (was?.kind === "play" || this.playing) this.openSpan("play", now, toS);
    else if (was) this.openSpan(was.kind, now, toS);
  }

  private openSpan(kind: OpenKind, now: number, atS: number, extra?: { interruptId?: string | null; cont?: boolean }) {
    this.open = {
      kind,
      id: crypto.randomUUID(),
      seq: this.seq++,
      startAt: now,
      fromS: atS,
      toS: atS,
      lastAdvanceAt: now,
      rate: this.rate,
      bg: this.hidden,
      interruptId: extra?.interruptId ?? null,
      cont: extra?.cont ?? false,
    };
  }

  /**
   * 播放段只往前长（播放头往回抖零点几秒不算），**而且只长到「按真实经过的时间本来就播得到」的地方**。
   *
   * ⚠️ lab 页上用 YouTube 自己的 → 键跳的时候实测到的：YouTube 跳之前会先报一下 PAUSED，
   * 而那一刻读到的秒数**已经是落点了**。不设这道上限，`onPause` 会把这一段一路长到落点
   * （「01:35 → 01:47 · 看了 12 秒」，其实只看了 2 秒），紧接着又记一行「01:37 → 01:47 在播放器上跳了」——
   * 同一截既算看过、又算跳过。读数跳远了就是一次跳转，交给 `tick` 去认。
   */
  private extendOpen(t: number, now: number) {
    const o = this.open;
    if (o?.kind !== "play" || !(t > o.toS)) return;
    const reach = ((now - o.lastAdvanceAt) / 1000) * o.rate + SEEK_EPS_S;
    if (t - o.toS > reach) return;
    o.toS = t;
    o.lastAdvanceAt = now;
  }

  private closeOpen(now: number) {
    const o = this.open;
    if (!o) return;
    this.open = null;
    if (o.kind === "play") {
      if (o.toS - o.fromS < 0.2) return; // 按了播放但画面还没动就停了 —— 不算看过
      const meta: WatchMeta = {};
      if (o.bg) meta.bg = true;
      if (o.cont) meta.cont = true;
      this.append({
        id: o.id,
        seq: o.seq,
        at: iso(o.startAt),
        kind: "play",
        fromS: o.fromS,
        toS: o.toS,
        durMs: Math.max(0, Math.round(o.lastAdvanceAt - o.startAt)),
        rate: o.rate,
        via: null,
        interruptId: null,
        meta: Object.keys(meta).length > 0 ? meta : null,
      });
      return;
    }
    const dur = Math.max(0, Math.round(now - o.startAt));
    if (dur < MIN_SPAN_MS) return;
    this.append({
      id: o.id,
      seq: o.seq,
      at: iso(o.startAt),
      kind: o.kind,
      fromS: o.fromS,
      toS: o.fromS,
      durMs: dur,
      rate: null,
      via: null,
      interruptId: o.interruptId,
      meta: null,
    });
  }

  private append(e: NewEvent) {
    const ev: WatchEvent = { ...e, id: e.id ?? crypto.randomUUID(), seq: e.seq ?? this.seq++, visitId: this.visitId };
    this.closed = [...this.closed, ev];
    if (!this.stopped) this.unsent.push(ev);
    if (ev.kind === "play" && ev.fromS != null && ev.toS != null) {
      this.closedPlays = [...this.closedPlays, { fromS: ev.fromS, toS: ev.toS }];
    }
    if (ev.kind === "seek" && ev.fromS != null && ev.toS != null && Math.abs(ev.toS - ev.fromS) >= LIST_MIN_JUMP_S) {
      this.seekSinceAsk = true;
    }
    if (ev.kind === "ask" && ev.meta?.reset && ev.interruptId) {
      this.resets = new Set(this.resets).add(ev.interruptId);
    }
  }

  private forget(batch: readonly WatchEvent[]) {
    const ids = new Set(batch.map((e) => e.id));
    this.unsent = this.unsent.filter((e) => !ids.has(e.id));
  }

  private materialize(now: number): WatchEvent | null {
    const o = this.open;
    if (!o) return null;
    const play = o.kind === "play";
    return {
      id: o.id,
      visitId: this.visitId,
      seq: o.seq,
      at: iso(o.startAt),
      kind: o.kind,
      fromS: o.fromS,
      toS: play ? o.toS : o.fromS,
      durMs: Math.max(0, Math.round((play ? o.lastAdvanceAt : now) - o.startAt)),
      rate: play ? o.rate : null,
      via: null,
      interruptId: o.interruptId,
      meta: play && o.bg ? { bg: true } : null,
    };
  }

  private notify(now = Date.now()) {
    this.lastLiveNotify = now;
    this.liveSnap = {
      events: this.closed,
      open: this.materialize(now),
      unsaved: this.unsent.length,
      trouble: this.trouble,
      dropped: this.dropped,
    };
    // 捕获轴只关心播放段：停着的时候每秒这一下不该把它也叫醒重画
    const o = this.open;
    const open = o?.kind === "play" && o.toS - o.fromS >= 0.2 ? { fromS: o.fromS, toS: o.toS } : null;
    const c = this.coverSnap;
    if (c.plays !== this.closedPlays || c.open?.fromS !== open?.fromS || c.open?.toS !== open?.toS) {
      this.coverSnap = { plays: this.closedPlays, open };
    }
    for (const cb of this.listeners) cb();
  }
}

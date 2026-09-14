"use client";

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { CoverageBar, TIER_SWATCH } from "@/components/coverage-track";
import { useCopy, useUiLang } from "@/components/copy-provider";
import type { Translate } from "@/lib/copy";
import { hms, mmss } from "@/lib/time";
import type { SourceKind } from "@/lib/types";
import {
  READ_CAP,
  buildActivity,
  coverageSegments,
  coverageSummary,
  questionMoments,
  type ActivityGroup,
  type ActivityRow,
  type PointLite,
} from "@/lib/watch-events";
import type { WatchRecorder } from "@/lib/watch-recorder";

// M3.15 片 c0 —— 右栏第二栏「互动记录」（D71，取代计划 §A 的「问题列表」）。
//
// 创始人 2026-09-11 的原话：「中心主旨就是让用户知道自己在这个视频的那些地方看了多少，
// 同时 capture 那个轴也在变化」「比如用户跳完 问了个问题 就这样按顺序来记录」。
// 所以这一栏是**一条时间线**：播了一段、停住、离开页面、跳（从哪到哪、怎么跳的）、问、记点 ——
// 按真实先后，**每个青色的时间都能点**（就地跳、不换路由、播放/暂停不变，照 D63 立返回牌）。
// 原来的「问题列表」＝ 顶上那颗「只看提问」。
//
// **只在宽屏挂载**，手机上一个像素都不动（那边照记、不显示）。
// **永远挂着、切走只是 hidden**（和问答栏一样）：各记各的滚动位置。但**藏着的时候不订记录器** ——
// D71：「正在播的那一段每秒更新一次，且只在这一栏打开时更新」。

// ── 「全部 / 只看提问」记在这台机器上（D71：localStorage 就够）──────────────
// 照 source-list.tsx / watch-stage 折叠开关的写法走 useSyncExternalStore：
// 在 useEffect 里 setState 读 localStorage 会被 `react-hooks/set-state-in-effect` 拦下，而且多一轮级联渲染。
const FILTER_KEY = "fermata.activity.filter";
type Filter = "all" | "asks";
let filterNow: Filter = "all";
let filterLoaded = false;
const filterListeners = new Set<() => void>();

function getFilter(): Filter {
  if (!filterLoaded) {
    filterLoaded = true;
    try {
      filterNow = window.localStorage.getItem(FILTER_KEY) === "asks" ? "asks" : "all";
    } catch {
      // Safari 无痕模式下 localStorage 会抛。记不住比崩了强
      filterNow = "all";
    }
  }
  return filterNow;
}
const getFilterOnServer = (): Filter => "all";

function subscribeFilter(cb: () => void): () => void {
  filterListeners.add(cb);
  return () => {
    filterListeners.delete(cb);
  };
}

function setFilter(next: Filter) {
  filterLoaded = true;
  if (filterNow === next) return;
  filterNow = next;
  try {
    window.localStorage.setItem(FILTER_KEY, next);
  } catch {
    // 存不下就只在这一次观看里有效
  }
  for (const cb of filterListeners) cb();
}

// ── 小工具 ──────────────────────────────────────────────────────────────

/** 「4 分 08 秒」「6 分钟」「27 秒」—— 怎么拼由文案表定（中英各一套） */
function durText(t: Translate, ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return t("act.dur", Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60);
}

const rateText = (r: number) => String(Math.round(r * 100) / 100);
/** 用真正的减号（U+2212），不用连字符 —— 「−5 秒」和「-5 秒」在等宽字里差得很明显 */
const stepText = (step: number) => {
  const v = Math.round(step);
  return v < 0 ? `−${-v}` : `+${v}`;
};
/** 问题太长就截 —— 「问题前 N 个字…」（D71），完整的点进问答里看 */
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

function useWhen(): (at: string) => string {
  const lang = useUiLang();
  return useMemo(() => {
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    };
    let f: Intl.DateTimeFormat;
    try {
      f = new Intl.DateTimeFormat(lang, opts);
    } catch {
      f = new Intl.DateTimeFormat(undefined, opts);
    }
    return (at: string) => {
      const d = new Date(at);
      return Number.isNaN(d.getTime()) ? "" : f.format(d);
    };
  }, [lang]);
}

// ── 图标：自己画，不用 ▶ ⏸ 这类字符 —— 在 Mac 上它们会被渲染成彩色 emoji ─────────

const SVG = "h-2.5 w-2.5";
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function RowIcon({ row }: { row: ActivityRow }) {
  switch (row.kind) {
    case "play":
      return (
        <svg viewBox="0 0 10 10" className={SVG} aria-hidden focusable="false">
          <path d="M2.2 1.3 8.6 5 2.2 8.7Z" fill="currentColor" />
        </svg>
      );
    case "pause":
      return (
        <svg viewBox="0 0 10 10" className={SVG} aria-hidden focusable="false">
          <path d="M2.4 1.6h1.8v6.8H2.4zM5.8 1.6h1.8v6.8H5.8z" fill="currentColor" />
        </svg>
      );
    case "leave":
      return (
        <svg viewBox="0 0 10 10" className={SVG} aria-hidden focusable="false">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4" />
        </svg>
      );
    case "seek":
      // 往后看 → 、往回 ←（D71 表里的 ↪ / ↩）
      return (
        <svg viewBox="0 0 10 10" className={SVG} aria-hidden focusable="false">
          <path {...STROKE} d={row.toS < row.fromS ? "M8.5 5H1.9M4.5 2.3 1.8 5l2.7 2.7" : "M1.5 5h6.6M5.5 2.3 8.2 5 5.5 7.7"} />
        </svg>
      );
    case "ask":
      // 问答点也是捕获点（D62），所以它和下面那颗点一样是青的 —— 青色在这一栏只答「这是个点」
      return <span className="ui-mono text-[0.68rem] font-semibold leading-none text-teal-300">?</span>;
    case "capture":
      return <span className="block h-2 w-2 rounded-full bg-teal-400" />;
  }
}

function TimeLink({
  s,
  at = false,
  onJump,
  t,
}: {
  s: number;
  at?: boolean;
  onJump: (s: number) => void;
  t: Translate;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(s)}
      aria-label={t("watch.qa.jumpTo", mmss(s))}
      className="ui-mono rounded px-0.5 text-teal-300 transition-colors hover:bg-ink-700 hover:text-teal-100"
    >
      {at ? "@" : ""}
      {mmss(s)}
    </button>
  );
}

const Sep = () => <span className="text-ink-500"> · </span>;

function Line({ row, children }: { row: ActivityRow; children: React.ReactNode }) {
  return (
    <li className="flex gap-1.5 py-0.5 text-[0.7rem] leading-5 text-ink-300">
      <span aria-hidden className="flex h-5 w-3 shrink-0 items-center justify-center text-ink-500">
        <RowIcon row={row} />
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </li>
  );
}

/** 「怎么跳的」—— 只写看得见的事实（D71：YouTube 里按了什么看不见，就只说「在播放器上」） */
function viaText(row: Extract<ActivityRow, { kind: "seek" }>, kind: SourceKind, t: Translate): string {
  switch (row.via) {
    case "player":
      return kind === "podcast" ? t("act.via.playerPodcast") : t("act.via.playerYoutube");
    case "at_link":
      return t("act.via.atLink", mmss(row.toS));
    case "back":
      return t("act.via.back", mmss(row.toS));
    case "dots":
      return t("act.via.dots");
    case "dots_nav":
      return t("act.via.dotsNav", row.n);
    case "caption":
      return t("act.via.caption");
    case "step":
      return t("act.via.step", stepText(row.step ?? row.toS - row.fromS), row.n);
    case "record":
      return t("act.via.record");
    case "card":
      return t("act.via.card");
  }
}

function RowView({
  row,
  kind,
  t,
  onJump,
  onOpenTurn,
}: {
  row: ActivityRow;
  kind: SourceKind;
  t: Translate;
  onJump: (s: number) => void;
  onOpenTurn: (id: string) => void;
}) {
  switch (row.kind) {
    case "play":
      return (
        <Line row={row}>
          <TimeLink s={row.fromS} onJump={onJump} t={t} /> → <TimeLink s={row.toS} onJump={onJump} t={t} />
          <Sep />
          {t("act.watchedFor", durText(t, row.lenS * 1000))}
          {row.rate !== 1 ? t("act.rate", rateText(row.rate)) : null}
          {row.bg ? t("act.bg") : null}
        </Line>
      );
    case "pause":
      return (
        <Line row={row}>
          {t("act.pausedAt")} <TimeLink s={row.atS} onJump={onJump} t={t} />
          <Sep />
          {t("act.pausedFor", durText(t, row.durMs))}
        </Line>
      );
    case "leave":
      return <Line row={row}>{t("act.left", durText(t, row.durMs))}</Line>;
    case "seek":
      return (
        <Line row={row}>
          <TimeLink s={row.fromS} onJump={onJump} t={t} /> → <TimeLink s={row.toS} onJump={onJump} t={t} />
          <Sep />
          {viaText(row, kind, t)}
        </Line>
      );
    case "ask":
      return (
        <Line row={row}>
          <TimeLink s={row.tS} at onJump={onJump} t={t} />{" "}
          {row.question ? (
            // 点**问题文字** = 切到「问答」、滚到那一轮、闪一下 —— **不动视频**（D71）。点时间才是跳
            <button
              type="button"
              onClick={() => onOpenTurn(row.interruptId)}
              aria-label={t("act.openTurn", row.question)}
              className="text-left text-ink-100 transition-colors hover:text-teal-300"
            >
              {t("act.quote", clip(row.question))}
            </button>
          ) : (
            <span className="text-ink-500">{t("act.noAnswer")}</span>
          )}
          {row.pauseMs >= 1000 ? (
            <>
              <Sep />
              {t("act.pausedFor", durText(t, row.pauseMs))}
            </>
          ) : null}
        </Line>
      );
    case "capture":
      return (
        <Line row={row}>
          <TimeLink s={row.tS} onJump={onJump} t={t} /> {t("act.captured")}
        </Line>
      );
  }
}

/**
 * 一组（一次打开观看页）。**以前那几次的组身份不变就不重画** —— 正在播的时候这一栏每秒刷新一次，
 * 该动的只有「这一次」那一组。开工先量第 4 条：2000 行假历史时，整栏每秒重画一次（开发模式）要 73ms，
 * 而关着这一栏只要 38ms —— 多出来的全是在重画早就不会再变的历史。
 */
const GroupView = memo(function GroupView({
  group,
  header,
  kind,
  t,
  onJump,
  onOpenTurn,
}: {
  group: ActivityGroup;
  header: string;
  kind: SourceKind;
  t: Translate;
  onJump: (s: number) => void;
  onOpenTurn: (id: string) => void;
}) {
  return (
    <section aria-label={header}>
      <h3 className="sticky top-0 z-[1] -mx-3 bg-ink-900 px-3 pb-1 pt-2 text-[0.62rem] font-semibold text-ink-500">
        {header}
      </h3>
      <ul>
        {group.rows.map((row) => (
          <RowView key={row.key} row={row} kind={kind} t={t} onJump={onJump} onOpenTurn={onOpenTurn} />
        ))}
      </ul>
    </section>
  );
});

/**
 * 颜色说明（D73）：三档绿各是看了几遍 + 那根白针是「现在播到哪」。
 * 创始人 2026-09-13 看片 c0 那版的第一反应是「颜色不对不够明显」—— 颜色自己不会解释自己，得给个说法。
 * 对读屏藏起来：它说明的那条色带本身就是 `aria-hidden`（同样的信息在「看过 X / Y」「回看最多」「跳过」那几句字里）。
 */
function CoverageLegend({ t }: { t: Translate }) {
  const tiers = [
    [TIER_SWATCH[1], t("act.legend1")],
    [TIER_SWATCH[2], t("act.legend2")],
    [TIER_SWATCH[3], t("act.legend3")],
  ] as const;
  return (
    <span aria-hidden className="ml-auto flex shrink-0 items-center gap-2 text-ink-500">
      {tiers.map(([bg, label]) => (
        <span key={bg} className="flex items-center gap-1">
          <span className={`inline-block h-2 w-3 rounded-sm ${bg}`} />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-0.5 rounded-full bg-ink-100 shadow-[0_0_0_1px_var(--color-ink-900)]" />
        {t("act.legendNow")}
      </span>
    </span>
  );
}

export function ActivityPanel({
  hidden,
  recorder,
  getCurrentTime,
  points,
  durationS,
  kind,
  capped,
  loadFailed,
  onJump,
  onOpenTurn,
}: {
  /** 切到别的 tab 了：不卸载、只 hidden，而且**不订**记录器（藏着的时候不每秒重画） */
  hidden: boolean;
  recorder: WatchRecorder;
  /** 播放器现在在第几秒 —— 顶上那条「现在在哪」那根针用（D73）。直接问播放器，不问记录器 */
  getCurrentTime: () => number;
  /** 这条内容所有的捕获点 —— 问题文字、追问关系从这儿拿（和问答栏、捕获轴同一份） */
  points: readonly PointLite[];
  durationS: number;
  kind: SourceKind;
  /** 首屏读取被截过（记录太多） */
  capped: boolean;
  /** 首屏没取到以前的记录（不是表不存在的那种）—— 这一次的照样在记 */
  loadFailed: boolean;
  /** 点任何一个时间：就地跳 + 立返回牌 + 记一行 `via = record`（qa-rail 那头做） */
  onJump: (s: number) => void;
  /** 点问题文字：切到「问答」、滚到那一轮、闪一下 */
  onOpenTurn: (interruptId: string) => void;
}) {
  const t = useCopy();
  const when = useWhen();

  // 藏着就不订 —— 订户没了，记录器每秒那一下就叫不醒这一栏
  const subscribe = useCallback(
    (cb: () => void) => (hidden ? () => {} : recorder.subscribe(cb)),
    [hidden, recorder],
  );
  const live = useSyncExternalStore(subscribe, recorder.getLive, recorder.getLive);
  const cover = useSyncExternalStore(subscribe, recorder.getCoverage, recorder.getCoverage);
  const filter = useSyncExternalStore(subscribeFilter, getFilter, getFilterOnServer);

  // 分两截算，**每秒那一下只动「这一次」**（开工先量第 4 条）：
  // ① 已经收口的全部事 —— 只在多了一件事时重算（不是每秒），以前几次的组对象身份不变，下面的 GroupView 直接跳过；
  // ② 这一次 + 正在长的那一段 —— 每秒重算，但只算这一次的事，和历史有多长无关。
  const closedGroups = useMemo(
    () => buildActivity(live.events, points, recorder.visitId, null, capped),
    [live.events, points, recorder.visitId, capped],
  );
  const currentEvents = useMemo(
    () => live.events.filter((e) => e.visitId === recorder.visitId),
    [live.events, recorder.visitId],
  );
  const liveGroup = useMemo(() => {
    if (!live.open) return null;
    // capped=true：这一截不放「更早」那一组（那一组在 ① 里算过了）
    const built = buildActivity([...currentEvents, live.open], points, recorder.visitId, live.open.id, true);
    return built.find((g) => g.current) ?? null;
  }, [currentEvents, live.open, points, recorder.visitId]);
  const groups = useMemo(
    () => (liveGroup ? [...closedGroups.filter((g) => !g.current), liveGroup] : closedGroups),
    [closedGroups, liveGroup],
  );
  // D72：「只看提问」按时间点分组、组里平铺（片 c0 是按提问先后排、追问缩进）
  const moments = useMemo(() => questionMoments(points), [points]);
  const segs = useMemo(() => coverageSegments(cover, durationS), [cover, durationS]);
  const summary = useMemo(() => coverageSummary(segs, durationS), [segs, durationS]);

  // ── 滚动：最新在最下面，停在底部就跟着长；上滑看历史时不抢（和问答栏同一条规矩）──
  // ⚠️ 位置在 `onScroll` 里一路记着，不在切走那一刻读 —— 那时元素已经 display:none，读到的永远是 0（片 b 实测踩过）
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const keptRef = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || hidden) return;
    el.scrollTop = atBottomRef.current ? el.scrollHeight : keptRef.current;
  }, [groups, moments, filter, hidden]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    keptRef.current = el.scrollTop;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const header = (g: ActivityGroup) =>
    g.earlier ? t("act.earlier") : g.current ? `${when(g.startAt)} · ${t("act.visitNow")}` : when(g.startAt);

  // 存不上要说出来，而且说得出是哪一种（D44）
  const trouble =
    live.trouble === "missing"
      ? { alert: true, text: t("act.missingTable") }
      : live.trouble === "auth"
        ? { alert: true, text: t("act.unsavedAuth", live.unsaved) }
        : live.trouble && live.unsaved > 0
          ? { alert: false, text: t("act.unsaved", live.unsaved) }
          : null;

  return (
    <div
      role="tabpanel"
      id="qa-rail-panel-activity"
      aria-labelledby="qa-tab-activity"
      hidden={hidden}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* ── 顶上：看过多少 + 那条更细的「看了几遍」+ 回看最多 / 跳过 + 颜色说明 + 筛选 ── */}
      <div className="shrink-0 border-b border-ink-700 px-3 pb-2 pt-2">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[0.68rem] text-ink-300">
            {durationS > 0
              ? t("act.watched", hms(summary.watchedS), hms(durationS), summary.pct)
              : t("act.watchedUnknown")}
          </p>
          <div role="group" aria-label={t("act.filterAria")} className="flex shrink-0 rounded-lg border border-ink-700 p-0.5">
            {(["all", "asks"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`h-6 rounded-md px-1.5 text-[0.62rem] transition-colors ${
                  filter === f ? "bg-ink-700/70 text-teal-300" : "text-ink-500 hover:text-ink-300"
                }`}
              >
                {f === "all" ? t("act.filter.all") : t("act.filter.asks")}
              </button>
            ))}
          </div>
        </div>

        <CoverageBar
          segs={segs}
          durationS={durationS}
          onJump={onJump}
          // 藏着的时候不传 —— 不然藏着也每 250ms 挪一次针
          getTime={hidden ? undefined : getCurrentTime}
        />

        {/* 回看最多 / 跳过（时间都能点）+ 颜色说明。放不下时说明自己折到下一行、靠右 */}
        {durationS > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.62rem] leading-4 text-ink-500">
            {summary.most || summary.skipped.length > 0 ? (
              <p className="min-w-0">
                {summary.most ? (
                  <span className="mr-2 inline-block">
                    {t("act.most")} <TimeLink s={summary.most.from} onJump={onJump} t={t} />–
                    <TimeLink s={summary.most.to} onJump={onJump} t={t} />
                    {t("act.times", summary.most.n)}
                  </span>
                ) : null}
                {summary.skipped.length > 0 ? (
                  <span className="inline-block">
                    {t("act.skipped")}{" "}
                    {summary.skipped.map((s, i) => (
                      <span key={s.from}>
                        {i > 0 ? t("act.listSep") : ""}
                        <TimeLink s={s.from} onJump={onJump} t={t} />–<TimeLink s={s.to} onJump={onJump} t={t} />
                      </span>
                    ))}
                  </span>
                ) : null}
              </p>
            ) : null}
            <CoverageLegend t={t} />
          </div>
        ) : null}

        {trouble ? (
          <p
            role={trouble.alert ? "alert" : "status"}
            className={`mt-1.5 text-[0.62rem] leading-4 ${trouble.alert ? "text-amber-300/90" : "text-ink-300"}`}
          >
            {trouble.text}
          </p>
        ) : null}
        {live.dropped > 0 ? (
          <p role="alert" className="mt-1 text-[0.62rem] leading-4 text-amber-300/90">
            {t("act.dropped", live.dropped)}
          </p>
        ) : null}
        {loadFailed ? <p className="mt-1 text-[0.62rem] leading-4 text-ink-500">{t("act.loadFailed")}</p> : null}
        {capped ? <p className="mt-1 text-[0.62rem] leading-4 text-ink-500">{t("act.capped", READ_CAP)}</p> : null}
      </div>

      {/* ── 时间线（或「只看提问」）── */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {filter === "asks" ? (
          moments.length === 0 ? (
            <p className="pt-3 text-xs leading-5 text-ink-500">{t("act.emptyAsks")}</p>
          ) : (
            <ul className="pt-2">
              {moments.map((m) => (
                // D72：同一个时间点问的归成一组 —— 时间只写一次，问题平铺在它右边（不再按追问缩进）
                <li key={m.tS} className="flex gap-1.5 py-1 text-[0.7rem] leading-5">
                  <span className="shrink-0">
                    <TimeLink s={m.tS} at onJump={onJump} t={t} />
                  </span>
                  <ul aria-label={t("act.momentAria", mmss(m.tS), m.items.length)} className="min-w-0 flex-1">
                    {m.items.map((q) => (
                      <li key={q.id}>
                        <button
                          type="button"
                          onClick={() => onOpenTurn(q.id)}
                          aria-label={t("act.openTurn", q.question)}
                          className="text-left text-ink-100 transition-colors hover:text-teal-300"
                        >
                          {q.question}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )
        ) : groups.length === 0 ? (
          <p className="pt-3 text-xs leading-5 text-ink-500">{t("act.empty")}</p>
        ) : (
          groups.map((g) => (
            <GroupView key={g.key} group={g} header={header(g)} kind={kind} t={t} onJump={onJump} onOpenTurn={onOpenTurn} />
          ))
        )}
      </div>
    </div>
  );
}

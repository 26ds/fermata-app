"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { thumbUrlFor } from "@/lib/thumb";
import { hms, mmss } from "@/lib/time";

// M3.6 历史与知识库 —— 一条内容一行：缩略图 + 标题 + 什么时候看的（D38）。
//
// 与「观看」tab 那张列表的分工要守住，别互相污染：
//   观看 = 我**导入**了什么（按导入时间、置顶/收藏在这里生效）；
//   这里 = 我**看过**什么（按观看时间、置顶收藏一概不参与排序）。
// 所以导入了没看的不出现在这一页，这不是 bug，是这一页的定义。
//
// **重看不另开一行**（创始人 2026-07-30 拍板）：同一支永远只占一行，
// 标「看过 N 次」+ 卡片叠影，按最近一次观看排最前。

// D42：文案集中在这里，M3.9 抽语言表时只动这一处
const COPY = {
  empty: "还没有看过的东西。去「观看」贴一条链接，看几分钟，这里就有了。",
  emptyFolders: "智能分类还没做好。等它上线，这里会自动把看过的东西归成几个文件夹。",
  watchedTo: "看到",
  timesPrefix: "看过",
  timesSuffix: "次",
  pausesSuffix: "个暂停点",
  buckets: {
    today: "今天看的",
    yesterday: "昨天看的",
    week: "本周看的",
    older: "更早看过",
    unknown: "时间不详",
  },
  unknownNote: "这些是加迁移 0007 之前看的 —— 那会儿还没有字段记「什么时候看的」。再看一遍就归位了。",
  untitled: "未命名内容",
};

export interface HistoryItem {
  id: string;
  kind: string;
  title: string | null;
  url: string | null;
  external_id: string | null;
  duration_s: number | null;
  last_position_s: number | null;
  /** 迁移 0007。null = 这条是加字段之前看的，落进「时间不详」 */
  last_watched_at: string | null;
  watch_count: number | null;
  thumb_url: string | null;
  /** 这条内容攒了几个暂停点（服务端数好传进来） */
  pause_count: number;
}

type BucketKey = keyof typeof COPY.buckets;

/**
 * 按**观看日期**落桶。M3.5 那版只能按导入日期（库里根本没有观看时间），
 * 迁移 0007 补上 last_watched_at 之后，这一页终于能如实说「今天看的」。
 */
function bucketOf(watchedAt: string | null, todayStart: number): BucketKey {
  if (!watchedAt) return "unknown";
  const day = new Date(watchedAt).setHours(0, 0, 0, 0);
  const days = Math.round((todayStart - day) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "older";
}

/**
 * 「今天零点」按**看的人所在时区**算 —— 服务端在 UTC、手机在 +08，
 * 同一条内容可能一个说"今天"一个说"昨天"，直接撞 hydration 不一致。
 * 走 useSyncExternalStore：服务端与水合首帧一律拿 null（不分组、平铺），水合完再重排。
 * 快照必须稳定，所以算一次就存住（照抄 M3.5 source-list 的做法，别再踩一次）。
 */
let cachedTodayStart: number | null = null;
const readTodayStart = () => (cachedTodayStart ??= new Date().setHours(0, 0, 0, 0));
const readServerTodayStart = () => null;
const subscribeNothing = () => () => {};

/** 缩略图取不到就画占位方块 —— 列表里**绝不留空白格子** */
function Thumb({ item }: { item: HistoryItem }) {
  const src = thumbUrlFor(item);
  // 拼出来的 YouTube 地址理论上都在，但私享/已删视频会 404。
  // 出错就换占位，不给用户看那个碎图标。
  const [failed, setFailed] = useState(false);
  const stacked = (item.watch_count ?? 0) > 1;
  const glyph = item.kind === "podcast" ? "◍" : item.kind === "youtube" ? "▷" : "𝄐";

  return (
    <span className="relative block shrink-0">
      {/* 叠影：看过不止一次才有。是"一摞"的暗示，不是真的多行 */}
      {stacked && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 h-full w-full rounded-lg border border-ink-500/50 bg-ink-900"
        />
      )}
      <span className="relative block h-[3.375rem] w-24 overflow-hidden rounded-lg border border-ink-700 bg-ink-700">
        {src && !failed ? (
          // 远程缩略图故意不走 next/image：那要在 next.config 里登记每个远程域名，
          // 而播客封面的域名是"用户贴什么算什么"，根本登记不完（M3.6-plan B 也是这么定的）
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-lg text-ink-500" aria-hidden>
            {glyph}
          </span>
        )}
      </span>
    </span>
  );
}

export function HistoryList({
  items,
  historyEnabled,
}: {
  items: HistoryItem[];
  /** 迁移 0007 跑过了吗。没跑就全落「时间不详」，页面照常能用 */
  historyEnabled: boolean;
}) {
  const todayStart = useSyncExternalStore(
    subscribeNothing,
    readTodayStart,
    readServerTodayStart,
  );

  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: HistoryItem[] }[] = [];
    if (todayStart == null) {
      // 水合前不分组，平铺一张列表（服务端和首帧必须长得一样）
      return items.length > 0 ? [{ key: "all", label: "", rows: items }] : [];
    }
    // items 已经是"最近看过"倒序（服务端排的），顺着连成组即可，组的先后天然就对
    for (const it of items) {
      const key = bucketOf(it.last_watched_at, todayStart);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(it);
      else out.push({ key, label: COPY.buckets[key], rows: [it] });
    }
    return out;
  }, [items, todayStart]);

  if (items.length === 0) {
    return <p className="py-10 text-center text-sm leading-6 text-ink-500">{COPY.empty}</p>;
  }

  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="mt-5 first:mt-3">
          {g.label && (
            <h3 className="px-1 pb-2 text-xs font-semibold tracking-wide text-ink-500">
              {g.label}
            </h3>
          )}
          {/* 「时间不详」那一组解释一句为什么，别让用户以为数据坏了 */}
          {g.key === "unknown" && historyEnabled && (
            <p className="px-1 pb-2 text-[0.7rem] leading-5 text-ink-500">{COPY.unknownNote}</p>
          )}
          <ul className="flex flex-col gap-1">
            {g.rows.map((s) => {
              const times = s.watch_count ?? 0;
              return (
                <li key={s.id}>
                  <Link
                    href={`/library/${s.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-ink-700 px-3 py-3 transition-colors hover:border-teal-400/60 hover:bg-ink-700/40"
                  >
                    <Thumb item={s} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm leading-6 text-ink-100">
                        {s.title ?? s.url ?? COPY.untitled}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                        <span>{s.kind}</span>
                        {s.duration_s ? <span>{hms(s.duration_s)}</span> : null}
                        {s.last_position_s && s.last_position_s > 5 ? (
                          <span className="ui-mono text-teal-300">
                            {COPY.watchedTo} {mmss(s.last_position_s)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                        {times > 1 && (
                          <span className="text-ink-300">
                            {COPY.timesPrefix} {times} {COPY.timesSuffix}
                          </span>
                        )}
                        {s.pause_count > 0 && (
                          <span>
                            {s.pause_count} {COPY.pausesSuffix}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-ink-500" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** ② 智能分类：本片只占位，真功能在 M3.8（D41） */
export function FoldersPlaceholder() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-ink-700 px-5 py-10 text-center">
      <span className="text-2xl text-ink-500" aria-hidden>
        ◫
      </span>
      <p className="mt-3 text-sm leading-6 text-ink-500">{COPY.emptyFolders}</p>
    </div>
  );
}

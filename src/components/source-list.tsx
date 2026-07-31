"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sourceOriginUrl } from "@/lib/source-origin";
import { withFrom, type BackFrom } from "@/lib/nav";

export interface SourceListItem {
  id: string;
  kind: string;
  title: string | null;
  url: string | null;
  external_id: string | null;
  duration_s: number | null;
  /** 导入时间。M3.5 分组用的就是它 —— 注意**不是**观看时间，见下方 bucketOf 的说明 */
  created_at: string | null;
  last_position_s: number | null;
  pinned_at: string | null;
  favorited_at: string | null;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * M3.5 内容库分组 —— 按**导入日期**落到「今天 / 昨天 / 本周 / 更早」。
 *
 * ⚠️ 创始人要的是"按**观看**的每一天"，但库里目前只有导入时间 `created_at`：
 * `last_position_s` 只记看到第几秒、不记什么时候看的。所以文案一律如实写「导入」，
 * **不假装是观看时间**。真要按观看时间，得加迁移 0007 `sources.last_watched_at`
 * 并在观看页写入 —— 那是另一笔账，先用一阵子再看值不值得（M3.5-plan B 部分）。
 *
 * 自动分类（②）和自建文件夹（③）本片不做。
 */
function bucketOf(createdAt: string | null, todayStart: number): { key: string; label: string } {
  if (!createdAt) return { key: "unknown", label: "时间不详" };
  const day = new Date(createdAt).setHours(0, 0, 0, 0);
  const days = Math.round((todayStart - day) / 86_400_000);
  if (days <= 0) return { key: "today", label: "今天导入" };
  if (days === 1) return { key: "yesterday", label: "昨天导入" };
  if (days < 7) return { key: "week", label: "本周导入" };
  return { key: "older", label: "更早导入" };
}

/**
 * 「今天零点」按**看的人所在时区**算 —— 服务端在 UTC、手机在 +08，同一条内容
 * 可能一个说"今天"一个说"昨天"，直接撞 hydration 不一致。
 *
 * 所以走 useSyncExternalStore：服务端与水合首帧一律拿 null（不分组、平铺一张列表），
 * 水合完再换成本地值重排。这是 React 官方给"客户端专属值"的口子，
 * 比 useEffect 里 setState 干净（那个写法会多一轮级联渲染，lint 也拦）。
 *
 * 快照必须稳定，否则 React 会判定"外部源一直在变"而反复重渲染 —— 所以算一次就存住。
 * 代价：页面开着不动跨过午夜，分组要等下次进页面才刷新。可以接受。
 */
let cachedTodayStart: number | null = null;
const readTodayStart = () => (cachedTodayStart ??= new Date().setHours(0, 0, 0, 0));
const readServerTodayStart = () => null;
const subscribeNothing = () => () => {};

/** 与服务端排序保持一致：置顶的在前（按置顶时间倒序），其余保持原顺序 */
function sortRows(rows: SourceListItem[]): SourceListItem[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pa = a.row.pinned_at;
      const pb = b.row.pinned_at;
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      if (pa && pb) return pa < pb ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

export function SourceList({
  items,
  flagsEnabled,
  from,
}: {
  items: SourceListItem[];
  /** 迁移 0003 跑过了吗。没跑就只留删除，置顶/收藏点了也没用 */
  flagsEnabled: boolean;
  /**
   * 当前在哪一栏。传下去挂到每行的链接上，观看页的返回箭头才知道该退回哪 ——
   * 从「★ 收藏」点进去再返回，不该把筛选状态吃掉（创始人 2026-07-31 那条"一层层返回"的延伸）
   */
  from?: BackFrom;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 服务端数据变了（切筛选、router.refresh 之后）就以服务端为准。
  // React 官方的"props 变化时调整 state"写法：在渲染中比对，不用 effect ——
  // 放进 effect 会先渲染一遍旧数据再闪一下。
  const [seen, setSeen] = useState(items);
  if (items !== seen) {
    setSeen(items);
    setRows(items);
  }

  // 水合前是 null（服务端与首帧都不分组），水合后换成本地"今天零点"再落组
  const todayStart = useSyncExternalStore(
    subscribeNothing,
    readTodayStart,
    readServerTodayStart,
  );

  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: SourceListItem[] }[] = [];
    const pinned = rows.filter((r) => r.pinned_at);
    const rest = rows.filter((r) => !r.pinned_at);
    // 置顶永远排最前，且不进日期分组（D16）
    if (pinned.length > 0) out.push({ key: "pinned", label: "置顶", rows: pinned });
    if (todayStart == null) {
      if (rest.length > 0) out.push({ key: "all", label: "", rows: rest });
      return out;
    }
    // rest 已经是导入时间倒序（服务端排的），顺着连成组即可，组的先后天然就对
    for (const r of rest) {
      const b = bucketOf(r.created_at, todayStart);
      const last = out[out.length - 1];
      if (last && last.key === b.key) last.rows.push(r);
      else out.push({ ...b, rows: [r] });
    }
    return out;
  }, [rows, todayStart]);

  // 打开面板时锁住背景滚动，并支持 Esc 关闭
  useEffect(() => {
    if (!menuId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuId(null);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [menuId]);

  const active = rows.find((r) => r.id === menuId) ?? null;

  async function toggleFlag(row: SourceListItem, flag: "pinned" | "favorited") {
    const field = flag === "pinned" ? "pinned_at" : "favorited_at";
    const next = row[field] ? null : new Date().toISOString();
    setBusy(true);
    setError("");
    setMenuId(null);
    const snapshot = rows;
    setRows((prev) =>
      sortRows(prev.map((r) => (r.id === row.id ? { ...r, [field]: next } : r))),
    );
    try {
      const res = await fetch(`/api/sources/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [flag]: next !== null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRows(snapshot);
        setError(data?.error ?? "改不动，请重试");
      } else {
        router.refresh();
      }
    } catch {
      setRows(snapshot);
      setError("网络不通，没改成");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: SourceListItem) {
    setBusy(true);
    setError("");
    setMenuId(null);
    const snapshot = rows;
    // 先从界面拿掉，失败再放回来 —— 手机上等一个网络往返太难受
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      const res = await fetch(`/api/sources/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRows(snapshot);
        setError(data?.error ?? "删除失败，请重试");
      } else {
        router.refresh();
      }
    } catch {
      setRows(snapshot);
      setError("网络不通，没能删掉");
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-500">
        这里还是空的。上面贴一条链接试试。
      </p>
    );
  }

  return (
    <>
      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="mt-4 first:mt-2">
          {g.label && (
            <h3 className="px-1 pb-1 text-xs font-semibold tracking-wide text-ink-500">
              {g.label}
            </h3>
          )}
          <ul className="flex flex-col">
            {g.rows.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-1 border-b border-ink-700/80"
              >
                <Link
                  href={withFrom(`/watch/${s.id}`, from)}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 text-sm hover:text-teal-300"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-700 text-ink-300" aria-hidden>
                    ▷
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {s.pinned_at && (
                        <span className="shrink-0 text-xs text-teal-300" title="已置顶" aria-label="已置顶">
                          ↑
                        </span>
                      )}
                      {s.favorited_at && (
                        <span className="shrink-0 text-xs text-teal-300" title="已收藏" aria-label="已收藏">
                          ★
                        </span>
                      )}
                      <span className="truncate text-ink-100">
                        {s.title ?? s.url ?? "未命名内容"}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                      <span>{s.kind}</span>
                      {s.duration_s ? <span>{mmss(s.duration_s)}</span> : null}
                      {s.last_position_s && s.last_position_s > 5 ? (
                        <span className="ui-mono text-teal-300">
                          watched to {mmss(s.last_position_s)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </Link>

                {/* ↗ 回到原网页：跟「⋯」一样放在 Link 外面，点它开原站、不误触进播放器 */}
                {(() => {
                  const origin = sourceOriginUrl(s);
                  return origin ? (
                    <a
                      href={origin}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`在原网站打开：${s.title ?? "这条内容"}`}
                      className="flex h-11 w-8 shrink-0 items-center justify-center text-base text-ink-500 hover:text-teal-300"
                    >
                      ↗
                    </a>
                  ) : null;
                })()}

                {/* 「⋯」必须在 Link 外面，否则点它会先跳转 */}
                <button
                  type="button"
                  onClick={() => setMenuId(s.id)}
                  disabled={busy}
                  aria-label={`${s.title ?? "这条内容"} 的更多操作`}
                  aria-haspopup="dialog"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-ink-500 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
                >
                  ⋯
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {active && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="内容操作"
        >
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setMenuId(null)}
            className="absolute inset-0 bg-black/55"
          />
          <div className="glass relative mx-2 mb-[max(0.5rem,env(safe-area-inset-bottom))] overflow-hidden rounded-3xl">
            <p className="truncate border-b border-ink-500/25 px-5 py-3.5 text-xs text-ink-300">
              {active.title ?? active.url ?? "未命名内容"}
            </p>

            <button
              type="button"
              onClick={() => toggleFlag(active, "pinned")}
              disabled={!flagsEnabled}
              className="flex min-h-14 w-full items-center gap-3 border-b border-ink-500/20 px-5 text-left text-sm text-ink-100 disabled:opacity-40"
            >
              <span className="w-5 text-center text-base text-teal-300" aria-hidden>↑</span>
              {active.pinned_at ? "取消置顶" : "置顶"}
            </button>

            <button
              type="button"
              onClick={() => toggleFlag(active, "favorited")}
              disabled={!flagsEnabled}
              className="flex min-h-14 w-full items-center gap-3 border-b border-ink-500/20 px-5 text-left text-sm text-ink-100 disabled:opacity-40"
            >
              <span className="w-5 text-center text-base text-teal-300" aria-hidden>★</span>
              {active.favorited_at ? "取消收藏" : "加入收藏"}
            </button>

            <button
              type="button"
              onClick={() => remove(active)}
              className="flex min-h-14 w-full items-center gap-3 px-5 text-left text-sm text-red-400"
            >
              <span className="w-5 text-center text-base" aria-hidden>✕</span>
              删除
            </button>

            {!flagsEnabled && (
              <p className="border-t border-ink-500/20 px-5 py-3 text-xs leading-5 text-ink-500">
                置顶和收藏需要先在 Supabase 跑一次
                <code className="text-ink-300"> 0003_source_flags.sql</code>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMenuId(null)}
            className="glass relative mx-2 mb-[max(0.75rem,env(safe-area-inset-bottom))] mt-2 min-h-14 rounded-3xl text-sm font-semibold text-ink-100"
          >
            取消
          </button>
        </div>
      )}
    </>
  );
}

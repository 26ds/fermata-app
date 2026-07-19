"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface SourceListItem {
  id: string;
  kind: string;
  title: string | null;
  url: string | null;
  duration_s: number | null;
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
}: {
  items: SourceListItem[];
  /** 迁移 0003 跑过了吗。没跑就只留删除，置顶/收藏点了也没用 */
  flagsEnabled: boolean;
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

      <ul className="mt-2 flex flex-col">
        {rows.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-1 border-b border-ink-700/80"
          >
            <Link
              href={`/watch/${s.id}`}
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

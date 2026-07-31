"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withFrom, type BackFrom } from "@/lib/nav";
import { hms } from "@/lib/time";

// M3.7 词库列表（D40）—— 两处共用一份：
//   `/library/[id]` tab2  本片词库
//   `/library/vocab`      全部词库（背词是跨视频的事）
//
// 点一条 = **回观看页跳到它出现的那一秒**，和点暂停点完全一样的动作 ——
// 用户学一次会两处（D40 原话）。这一页没有播放器，所以只能真跳页。

// D42：文案集中在这里，M3.9 抽语言表时只动这一处
const COPY = {
  empty: "还没收过词。看视频时停下来，面板里高亮的词组点一下、或者行尾打个勾，就收到这儿了。",
  emptyAll: "词库还是空的。任意一条内容里停一下，面板里会把值得收的表达标出来，点一下就收进来。",
  remove: "从词库去掉",
  removeFailed: "没删掉，请重试",
  noTime: "—",
  jumpHint: "跳回原声",
};

export interface VocabItem {
  id: string;
  term: string;
  gloss: string | null;
  context_quote: string | null;
  t_s: number | null;
  source_id: string | null;
  /** 只有「全部词库」要显示出处 */
  source_title?: string | null;
}

export function VocabList({
  items,
  from,
  showSource = false,
  emptyAll = false,
}: {
  items: VocabItem[];
  /** 跳去观看页后，那边的返回箭头退回哪一层（D43） */
  from: BackFrom;
  showSource?: boolean;
  emptyAll?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [error, setError] = useState("");

  // 服务端数据变了就以服务端为准。渲染期校正，不用 effect（本项目统一写法）
  const [seen, setSeen] = useState(items);
  if (items !== seen) {
    setSeen(items);
    setRows(items);
  }

  // 删除失败要回滚到"删之前"，但 remove 得保持稳定身份 —— 快照走 ref
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const remove = useCallback(async (id: string) => {
    const snapshot = rowsRef.current;
    setError("");
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/atoms/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(COPY.removeFailed);
    } catch {
      setRows(snapshot); // 回滚，别让一条词凭空消失
      setError(COPY.removeFailed);
    }
  }, []);

  const open = useCallback(
    (row: VocabItem) => {
      if (!row.source_id) return;
      const t = row.t_s != null ? `?t=${Math.round(row.t_s)}` : "";
      router.push(withFrom(`/watch/${row.source_id}${t}`, from));
    },
    [router, from],
  );

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-ink-700 px-5 py-10 text-center">
        <span className="text-2xl text-ink-500" aria-hidden>
          ✓
        </span>
        <p className="mt-3 text-sm leading-6 text-ink-500">{emptyAll ? COPY.emptyAll : COPY.empty}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-xl border border-ink-500/50 bg-ink-700 px-3 py-2 text-xs text-teal-300">
          {error}
        </p>
      )}
      {rows.map((row) => (
        // relative + 覆盖按钮：整条可点（跳回原声），但「删掉」得是自己的按钮，
        // 按钮不能套按钮（和字幕行同一个套路）
        <div key={row.id} className="relative rounded-2xl border border-ink-700">
          <button
            type="button"
            onClick={() => open(row)}
            disabled={!row.source_id}
            aria-label={`${COPY.jumpHint}：${row.term}`}
            className="absolute inset-0 rounded-2xl transition-colors hover:bg-ink-700/40 disabled:cursor-default disabled:hover:bg-transparent"
          />
          <div className="pointer-events-none relative flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2">
                <span className="min-w-0 break-words text-sm font-semibold text-ink-100">{row.term}</span>
                <span className="ui-mono shrink-0 text-[0.68rem] text-teal-300">
                  {row.t_s != null ? hms(row.t_s) : COPY.noTime}
                </span>
              </p>
              {row.gloss && <p className="mt-0.5 text-xs leading-5 text-ink-300">{row.gloss}</p>}
              {row.context_quote && (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">「{row.context_quote}」</p>
              )}
              {showSource && row.source_title && (
                <p className="mt-1 truncate text-[0.68rem] text-ink-500">{row.source_title}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(row.id)}
              aria-label={`${COPY.remove}：${row.term}`}
              className="pointer-events-auto relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm text-ink-500 transition-colors hover:bg-ink-700 hover:text-teal-300"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

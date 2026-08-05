"use client";

import { useCallback, useRef, useState } from "react";
import { WordBubble, type BubbleAnchor } from "@/components/word-bubble";
import type { Lookup } from "@/lib/senses/types";

// M3.11 —— 悬浮词卡的那一份状态。**全页只有一份**（性能红线）：
// 字幕列表每 250ms 就跟着当前行重渲染一次，要是每一行各揣一个气泡 state，
// 手机会烫。所以状态挂在 `watch-stage`，两个入口（暂停面板 / 字幕层）共用同一份。

/** 鼠标从词上移到气泡上的那一瞬间，中间是有缝的 —— 留一口气别让它闪掉 */
const LEAVE_GRACE_MS = 120;

export function useWordLookup({
  sourceId,
  atomIdOf,
}: {
  sourceId: string;
  /** 这个词对应哪条 atom（阴影词一定有）。语境意思就存在那条上，白拿 */
  atomIdOf: (term: string) => string | undefined;
}) {
  const [anchor, setAnchor] = useState<BubbleAnchor | null>(null);
  const [data, setData] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const leaveTimer = useRef<number | null>(null);
  const overBubble = useRef(false);
  /** 请求序号：连着扫过好几个词时，只认最后那一次的回包 */
  const reqRef = useRef(0);
  /**
   * 这一次观看里查过的词，就地记着。
   * 服务端已经有全站共享缓存了，这一层是**连那趟网络都省掉** ——
   * 同一个词第二次悬浮必须是"瞬间"，不能有任何一帧空白（验收⑥）。
   */
  const memo = useRef(new Map<string, Lookup>());

  const clearLeave = () => {
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const close = useCallback(() => {
    clearLeave();
    overBubble.current = false;
    reqRef.current += 1; // 作废在飞的那一趟，免得它回来又把气泡点亮
    setAnchor(null);
    setData(null);
    setError("");
    setLoading(false);
  }, []);

  const fetchLookup = useCallback(
    async (term: string, contextQuote: string) => {
      const seq = ++reqRef.current;
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ term, contextQuote, sourceId, atomId: atomIdOf(term) }),
        });
        const body = await res.json().catch(() => ({}));
        if (seq !== reqRef.current) return; // 早换词了，这一包已经过期
        if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "没查到");
        const next: Lookup = {
          term,
          context: body.context ?? undefined,
          senses: Array.isArray(body.senses) ? body.senses : [],
          supportLang: typeof body.supportLang === "string" ? body.supportLang : "",
          sensesStatus: body.sensesStatus === "failed" ? "failed" : body.sensesStatus === "none" ? "none" : "ok",
        };
        // **只有查成了才进内存缓存** —— 把一次失败缓存住，等于让它这一场再也查不出来
        if (next.sensesStatus !== "failed") memo.current.set(term, next);
        setData(next);
        if (next.sensesStatus === "failed" && typeof body.error === "string") setError(body.error);
      } catch (e) {
        if (seq !== reqRef.current) return;
        setError(e instanceof Error ? e.message : "没查到");
      } finally {
        if (seq === reqRef.current) setLoading(false);
      }
    },
    [sourceId, atomIdOf],
  );

  /** 悬浮 / 长按到了一个阴影词上 */
  const open = useCallback(
    (term: string, rect: DOMRect, contextQuote: string) => {
      clearLeave();
      overBubble.current = false;
      setAnchor({ term, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } });
      const hit = memo.current.get(term);
      if (hit) {
        // 这一场查过了 → 一个请求都不发，气泡当场就是满的
        reqRef.current += 1;
        setData(hit);
        setError("");
        setLoading(false);
        return;
      }
      setData(null);
      void fetchLookup(term, contextQuote);
    },
    [fetchLookup],
  );

  /** 鼠标离开那个词。**不立刻关** —— 他可能正要把鼠标移进气泡里看第二行 */
  const leave = useCallback(() => {
    clearLeave();
    leaveTimer.current = window.setTimeout(() => {
      if (!overBubble.current) close();
    }, LEAVE_GRACE_MS);
  }, [close]);

  const bubble = anchor ? (
    <WordBubble
      anchor={anchor}
      data={data}
      loading={loading}
      error={error}
      onRetry={() => {
        memo.current.delete(anchor.term);
        void fetchLookup(anchor.term, "");
      }}
      onClose={close}
      onPointerEnter={() => {
        overBubble.current = true;
        clearLeave();
      }}
      onPointerLeave={() => {
        overBubble.current = false;
        leave();
      }}
    />
  ) : null;

  return { bubble, open, leave, close };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { PauseList, type PausePoint } from "@/components/pause-list";
import type { TranscriptSegment } from "@/lib/types";

// M3.6 —— `/library/[id]` 的两个 tab（D38）。**这一页没有播放器。**
//
// tab1 是 M3.5 做的暂停点回看**整块搬过来**的（创始人 2026-07-30：它不该出现在看视频的界面）。
// 搬家之后多了一件观看页做不了的事：**按"哪天看的那次"分堆** ——
// 在观看页上，暂停点只能按时间轴排；在这里，"7 月 30 日那次我停了 6 下"才是回看的线索。
//
// 和观看页的关键差别：点一行是**真跳页**（这里没有播放器可 seek），
// 跳 `/watch/[id]?t=<秒>`，观看页认这个参数并把播放头放过去。

// D42：文案集中在这里，M3.9 抽语言表时只动这一处
const COPY = {
  tabPauses: "暂停点与聊天",
  tabVocab: "词库",
  chatRow: (n: number) => `和这条内容聊过 ${n} 轮`,
  chatOpen: "打开 →",
  daySuffix: " · 那次看的",
  dayToday: "今天",
  dayYesterday: "昨天",
  dayUnknown: "时间不详",
  emptyPauses: "这条内容你还没停过。回观看页看的时候点右下角悬浮球，停下的每一刻都会记在这里。",
  vocabSoon: "词库还没做好。等它上线，你在字幕上勾中的词组会存到这里，点一下就能跳回它出现的那一秒。",
  deleteFailed: "没删掉，请重试",
};

/** 比观看页那份多一个 created_at —— 分堆靠它 */
export interface DatedPausePoint extends PausePoint {
  created_at: string | null;
}

/** 同一天的暂停点归一堆。key 走本地年月日，跨时区不会串 */
function dayKeyOf(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayLabelOf(iso: string | null, todayStart: number): string {
  if (!iso) return COPY.dayUnknown + COPY.daySuffix;
  const day = new Date(iso).setHours(0, 0, 0, 0);
  const days = Math.round((todayStart - day) / 86_400_000);
  if (days <= 0) return COPY.dayToday + COPY.daySuffix;
  if (days === 1) return COPY.dayYesterday + COPY.daySuffix;
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日${COPY.daySuffix}`;
}

/**
 * 「今天零点」按**看的人所在时区**算。服务端在 UTC、手机在 +08，
 * 直接算会撞 hydration 不一致 —— 这一套（稳定快照 + 服务端返回 null）照抄 M3.5，别再踩一次。
 * 水合前不分堆，平铺一张列表；水合完再按天分开。
 */
let cachedTodayStart: number | null = null;
const readTodayStart = () => (cachedTodayStart ??= new Date().setHours(0, 0, 0, 0));
const readServerTodayStart = () => null;
const subscribeNothing = () => () => {};

export function LibraryDetail({
  sourceId,
  points,
  transcript,
  chatRounds,
}: {
  sourceId: string;
  points: DatedPausePoint[];
  transcript: TranscriptSegment[] | null;
  chatRounds: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"pauses" | "vocab">("pauses");
  const [rows, setRows] = useState(points);

  // 服务端数据变了（router.refresh 之后）就以服务端为准。渲染期校正，不用 effect
  const [seen, setSeen] = useState(points);
  if (points !== seen) {
    setSeen(points);
    setRows(points);
  }

  // 删除失败要回滚到"删之前"，但 handleDelete 得保持稳定身份（PauseList 按 props 记回调）
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const todayStart = useSyncExternalStore(
    subscribeNothing,
    readTodayStart,
    readServerTodayStart,
  );

  const groups = useMemo(() => {
    if (todayStart == null) return null; // 水合前：不分堆，平铺
    const map = new Map<string, { label: string; at: number; rows: DatedPausePoint[] }>();
    for (const p of rows) {
      const key = dayKeyOf(p.created_at);
      const at = p.created_at ? new Date(p.created_at).getTime() : 0;
      const g = map.get(key);
      if (g) {
        g.rows.push(p);
        g.at = Math.max(g.at, at);
      } else {
        map.set(key, { label: dayLabelOf(p.created_at, todayStart), at, rows: [p] });
      }
    }
    // 最近看的那次排最前（组内的排序交给 PauseList，它按秒数升序）
    return [...map.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.at - a.at);
  }, [rows, todayStart]);

  const handleDelete = useCallback(async (id: string) => {
    const snapshot = rowsRef.current;
    setRows((prev) => prev.filter((p) => p.id !== id));
    try {
      const res = await fetch(`/api/interrupts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? COPY.deleteFailed);
      }
    } catch (e) {
      setRows(snapshot); // 回滚，别让点凭空消失
      throw e;
    }
  }, []);

  // 这一页没有播放器 —— 点一行是真跳页。观看页认 ?t= 并把播放头放过去
  const handleSeek = useCallback(
    (t: number) => {
      router.push(`/watch/${sourceId}?t=${Math.round(t)}`);
    },
    [router, sourceId],
  );

  // 沉浸聊天是观看页上的一层浮层（D33，它不是路由）——
  // 所以"打开聊天"只能跳回观看页并让它自己进沉浸态
  const openChat = useCallback(() => {
    router.push(`/watch/${sourceId}?chat=1`);
  }, [router, sourceId]);

  return (
    <>
      <div className="mt-6 flex items-center gap-1 border-b border-ink-500/30 pb-3">
        {(
          [
            ["pauses", COPY.tabPauses],
            ["vocab", COPY.tabVocab],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
              tab === key ? "bg-ink-700 text-teal-300" : "text-ink-500 hover:text-ink-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "vocab" ? (
        <div className="mt-6 rounded-2xl border border-dashed border-ink-700 px-5 py-10 text-center">
          <span className="text-2xl text-ink-500" aria-hidden>
            ✓
          </span>
          <p className="mt-3 text-sm leading-6 text-ink-500">{COPY.vocabSoon}</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {/* 沉浸聊天不锚在某一秒，所以它单独占一行、排在所有日期分堆之上
              （D33：短问答和长聊天分家，界面上也别糊在一起） */}
          {chatRounds > 0 && (
            <button
              type="button"
              onClick={openChat}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-ink-700 bg-ink-900/40 px-4 text-left transition-colors hover:border-teal-400/60 hover:bg-ink-700/40"
            >
              <span className="text-base text-teal-300" aria-hidden>
                ◎
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-100">
                {COPY.chatRow(chatRounds)}
              </span>
              <span className="shrink-0 text-xs text-ink-500">{COPY.chatOpen}</span>
            </button>
          )}

          {rows.length === 0 ? (
            <p className="rounded-2xl border border-ink-700 px-4 py-6 text-center text-sm leading-6 text-ink-500">
              {COPY.emptyPauses}
            </p>
          ) : groups == null ? (
            // 水合前：一张平铺的列表（必须和服务端渲染出来的一模一样）
            <PauseList
              points={rows}
              transcript={transcript}
              chatRounds={0}
              onSeek={handleSeek}
              onDelete={handleDelete}
              onOpenChat={openChat}
            />
          ) : (
            groups.map((g) => (
              <PauseList
                key={g.key}
                heading={g.label}
                points={g.rows}
                transcript={transcript}
                chatRounds={0}
                onSeek={handleSeek}
                onDelete={handleDelete}
                onOpenChat={openChat}
              />
            ))
          )}
        </div>
      )}
    </>
  );
}

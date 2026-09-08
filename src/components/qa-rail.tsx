"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { useCopy } from "@/components/copy-provider";
import type { CopyKey } from "@/lib/copy/keys";

// M3.15 片 a —— 右栏三个栏目的**骨架**（计划 §A / D61）。
//
// 三个 tab：① 问答 ② 问题列表 ③ Takeaway。同一时刻只显示一个。
// **字幕不是其中之一** —— 它按布局模式待在别处（§D），片 a 里就还在这三个栏上面。
//
// 这一片只做壳：切得动、各记各的滚动位置、空态说人话。
// 里面的内容分别是片 b（问答本体）、片 d（问题列表 + `@`）、片 e（Takeaway）的活。
// **空态里写「功能开发中」是照 `watch.captures.help` 的规矩**（D44：
// 没做的事不许在界面上说得像做好了）。

export type QaTab = "chat" | "questions" | "takeaway";

/** 顺序就是界面上的顺序。**key 写死成字面量**，不拿模板串拼 —— 拼出来的 key 逃过类型检查，
 *  漏一条要等到运行时才看得见（而 `en.ts` 漏一条编译不过的那道闸门也就白设了） */
const TABS = [
  { id: "chat", label: "watch.rail.tab.chat" },
  { id: "questions", label: "watch.rail.tab.questions" },
  { id: "takeaway", label: "watch.rail.tab.takeaway" },
] as const satisfies readonly { id: QaTab; label: CopyKey }[];

/**
 * 三个栏各记各的滚动位置（片 a 的交付判据之一）。
 *
 * ⚠️ **不能只靠"三个都挂着、用 CSS 藏起来"** —— 元素一旦 `display:none`，
 * 部分浏览器会把 `scrollTop` 抹成 0，切回来就跳到顶上。所以这里**显式存、显式还**：
 * 切走那一刻把当前 `scrollTop` 记进 ref，切回来在 `useLayoutEffect` 里写回去
 * （用 layout effect 不用 effect：要赶在浏览器画这一帧**之前**还原，
 * 否则会看见先跳到顶、再弹回去）。
 */
export function QaRail({
  tab,
  onTab,
  onCaptureNow,
  capturing,
  captureError,
  pointCount,
}: {
  tab: QaTab;
  onTab: (next: QaTab) => void;
  /**
   * 「只记下这一刻，先不问」。**这是悬浮球在宽屏上的替身**（§F）——
   * 球在宽屏不再挂载，这个能力不能跟着一起没了。
   * 片 b 会把它挪到输入框边上，那才是它最终的家。
   */
  onCaptureNow: () => void;
  capturing: boolean;
  /** 没记上就要说是哪一种失败，**不许静默**（D44） */
  captureError: string;
  pointCount: number;
}) {
  const t = useCopy();
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<Record<QaTab, number>>({ chat: 0, questions: 0, takeaway: 0 });

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = scrollRef.current[tab];
  }, [tab]);

  const switchTo = useCallback(
    (next: QaTab) => {
      if (next === tab) return;
      const el = bodyRef.current;
      if (el) scrollRef.current[tab] = el.scrollTop;
      onTab(next);
    },
    [tab, onTab],
  );

  return (
    // `min-h-0` + 里面那层 `overflow-y-auto`：两个一起才成立 —— flex 子项不写
    // `min-h-0` 就不肯缩到内容以下，overflow 永远触发不了（和右栏同一条老规矩）。
    <section
      aria-label={t("watch.rail.aria")}
      className="flex min-h-0 flex-1 flex-col rounded-2xl border border-ink-700"
    >
      {/* 三个 tab。用 role=tablist 而不是三颗光秃秃的按钮：读屏的人要听得出
          「三选一」和「当前是第几个」，那是 aria-selected 才给得了的信息 */}
      <div role="tablist" aria-label={t("watch.rail.aria")} className="flex shrink-0 items-center gap-1 border-b border-ink-700 px-2 py-1.5">
        {TABS.map(({ id, label }) => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`qa-tab-${id}`}
              aria-selected={active}
              aria-controls="qa-rail-panel"
              onClick={() => switchTo(id)}
              className={`h-8 rounded-lg px-2.5 text-[0.72rem] transition-colors ${
                active ? "bg-ink-700/60 text-teal-300" : "text-ink-500 hover:text-ink-300"
              }`}
            >
              {t(label)}
              {/* 问题列表那一颗顺带报个数 —— 点点条上已经有这个数，两处对得上才不让人犯嘀咕 */}
              {id === "questions" && pointCount > 0 ? (
                <span className="ui-mono ml-1 text-[0.62rem] text-ink-500">{pointCount}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        ref={bodyRef}
        role="tabpanel"
        id="qa-rail-panel"
        aria-labelledby={`qa-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {tab === "chat" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-5 text-ink-500">{t("watch.rail.empty.chat")}</p>
            {/* 悬浮球的替身。**先不问、只记下这一刻** —— 记完点点条上当场多一个点 */}
            <div>
              <button
                type="button"
                onClick={onCaptureNow}
                disabled={capturing}
                className="h-9 rounded-xl border border-ink-700 px-3 text-xs text-ink-200 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:pointer-events-none disabled:opacity-50"
              >
                {capturing ? t("watch.rail.capturing") : t("watch.rail.capture")}
              </button>
              {captureError && (
                <p role="status" className="mt-2 text-[0.68rem] leading-4 text-amber-300/90">
                  {captureError}
                </p>
              )}
            </div>
          </div>
        )}
        {tab === "questions" && (
          <p className="text-xs leading-5 text-ink-500">{t("watch.rail.empty.questions")}</p>
        )}
        {tab === "takeaway" && (
          <p className="text-xs leading-5 text-ink-500">{t("watch.rail.empty.takeaway")}</p>
        )}
      </div>
    </section>
  );
}

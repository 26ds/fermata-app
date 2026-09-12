"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { useCopy } from "@/components/copy-provider";
import type { PausePoint } from "@/components/pause-list";
import { QaChat } from "@/components/qa-chat";
import type { CopyKey } from "@/lib/copy/keys";

// M3.15 片 a —— 右栏三个栏目的**骨架**（计划 §A / D61）。
//
// 三个 tab：① 问答 ② 问题列表 ③ Takeaway。同一时刻只显示一个。
// **字幕不是其中之一** —— 它按布局模式待在别处（§D），片 a 里就还在这三个栏上面。
//
// 片 a 只做壳：切得动、各记各的滚动位置、空态说人话。
// **片 b 把第一栏填上了**（`qa-chat.tsx`）；②③ 仍是空态，分别是片 d、片 e 的活。
// **空态里写「功能开发中」是照 `watch.captures.help` 的规矩**（D44：
// 没做的事不许在界面上说得像做好了）——**反过来也成立**：做好了的事不许还写着"开发中"，
// 所以片 b 落地时把 `watch.rail.empty.chat` 那句里的「（功能开发中）」删掉了。

export type QaTab = "chat" | "questions" | "takeaway";

/** 顺序就是界面上的顺序。**key 写死成字面量**，不拿模板串拼 —— 拼出来的 key 逃过类型检查，
 *  漏一条要等到运行时才看得见（而 `en.ts` 漏一条编译不过的那道闸门也就白设了） */
const TABS = [
  { id: "chat", label: "watch.rail.tab.chat" },
  { id: "questions", label: "watch.rail.tab.questions" },
  { id: "takeaway", label: "watch.rail.tab.takeaway" },
] as const satisfies readonly { id: QaTab; label: CopyKey }[];

/**
 * ②③ 两栏共用一个滚动容器，**各记各的滚动位置**（片 a 的交付判据之一）。
 *
 * ⚠️ **不能只靠"两个都挂着、用 CSS 藏起来"** —— 元素一旦 `display:none`，
 * 部分浏览器会把 `scrollTop` 抹成 0，切回来就跳到顶上。所以这里**显式存、显式还**：
 * 切走那一刻把当前 `scrollTop` 记进 ref，切回来在 `useLayoutEffect` 里写回去
 * （用 layout effect 不用 effect：要赶在浏览器画这一帧**之前**还原，
 * 否则会看见先跳到顶、再弹回去）。
 *
 * ⚠️ **① 问答不在这个容器里**（片 b 改的）：它底下钉着输入框和返回牌，
 * 能滚的只有上半截的消息流。所以它自己是一个独立的滚动容器、
 * 自己记自己的位置（同一套写法，搬进了 `qa-chat.tsx`）。
 * 而且它**永远挂着、切走只是 `hidden`** —— 卸载会把正在流式作答的那一轮打断，
 * 切去「问题列表」看一眼再切回来，答案就没了。
 */
export function QaRail({
  tab,
  onTab,
  onCaptureNow,
  capturing,
  captureError,
  pointCount,
  chat,
}: {
  tab: QaTab;
  onTab: (next: QaTab) => void;
  /**
   * 「只记下这一刻，先不问」。**这是悬浮球在宽屏上的替身**（§F）——
   * 球在宽屏不再挂载，这个能力不能跟着一起没了。
   * **片 b 已经把它挪到输入框边上了**（`qa-chat.tsx` 里那颗），这里只负责往下传。
   */
  onCaptureNow: () => void;
  capturing: boolean;
  /** 没记上就要说是哪一种失败，**不许静默**（D44） */
  captureError: string;
  pointCount: number;
  /** 片 b：问答那一栏要的东西。壳不认识它们，原样往下递 */
  chat: Omit<
    React.ComponentProps<typeof QaChat>,
    "hidden" | "onCaptureNow" | "capturing" | "captureError"
  > & { points: PausePoint[] };
}) {
  const t = useCopy();
  const bodyRef = useRef<HTMLDivElement>(null);
  // 只剩 ②③ 两栏用它 —— ① 自己记自己的（见上面那段）
  const scrollRef = useRef<Record<"questions" | "takeaway", number>>({
    questions: 0,
    takeaway: 0,
  });

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && tab !== "chat") el.scrollTop = scrollRef.current[tab];
  }, [tab]);

  const switchTo = useCallback(
    (next: QaTab) => {
      if (next === tab) return;
      const el = bodyRef.current;
      if (el && tab !== "chat") scrollRef.current[tab] = el.scrollTop;
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
              aria-controls={id === "chat" ? "qa-rail-panel-chat" : "qa-rail-panel"}
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

      {/* ① 问答：**永远挂着**，切走只是 hidden（正在流式的答案不能被卸载打断） */}
      <QaChat
        {...chat}
        hidden={tab !== "chat"}
        onCaptureNow={onCaptureNow}
        capturing={capturing}
        captureError={captureError}
      />

      {/* ②③ 共用一个滚动容器。它们还是空态 —— 分别是片 d、片 e 的活 */}
      {tab !== "chat" && (
        <div
          ref={bodyRef}
          role="tabpanel"
          id="qa-rail-panel"
          aria-labelledby={`qa-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          {tab === "questions" && (
            <p className="text-xs leading-5 text-ink-500">{t("watch.rail.empty.questions")}</p>
          )}
          {tab === "takeaway" && (
            <p className="text-xs leading-5 text-ink-500">{t("watch.rail.empty.takeaway")}</p>
          )}
        </div>
      )}

    </section>
  );
}

"use client";

import { useCopy } from "@/components/copy-provider";
import { type AnswerRef, refQuote, refTime } from "@/lib/answer-refs";
import { mmss } from "@/lib/time";

// M3.15 片 c —— 概述卡（计划 §二 / D64）。**只在宽屏问答栏里出现**（手机上的暂停面板照旧是答案里的一段话）。
//
// 一张纯文字卡：第几秒 · 前面 / 后面 + AI 写的一句话 + 那一秒的字幕原句（抄的，不是编的）。
// **点卡片 = 就地跳过去 + 留返回牌**（D63，牌子归 qa-rail 管；这一跳在互动记录里记作「点概述卡」）。
// 为什么不是一张图：任意一秒的画面我们拿不到（计划 §二复核过四条路），播客本来也没画面 —— 两边一个样子。
//
// **核不上字幕的那张（D64）：照出、灰着、不可点，写明是哪一种** ——
// 创始人 2026-09-07：「没找到，直接一点，而不是不给」。闷着不给等于替 AI 圆谎，他还以为 AI 什么都没说。
// 颜色一物一义：青色只给「能点的时间」，所以核不上那张的时间是灰的、边框是虚线。
//
// 片 g3：字号一律写 em —— 卡片长在问答栏的消息流里，跟着那一层的 `--chat-fs` 一起变大变小（「字体 − +」）。
// 比例照抄原来的 rem 写法（按 14px 算），字号一变整张卡按比例缩放。AI 那一句和原句用问答栏的字体（`font-chat`），时间照旧等宽

export function RefCards({
  refs,
  fromS,
  onJump,
}: {
  refs: readonly AnswerRef[];
  /** 这一问的那一秒 —— 「前面 / 后面」是相对它说的 */
  fromS: number;
  onJump: (t: number) => void;
}) {
  const t = useCopy();
  if (refs.length === 0) return null;
  return (
    <ul aria-label={t("watch.qa.refsAria")} className="mt-2.5 flex flex-col gap-1.5">
      {refs.map((r, i) => {
        const at = refTime(r);
        const quote = refQuote(r);
        // 计划 §二 那张草图的样子：**第一行 = 时间 + AI 那一句，第二行 = 原句**。
        // 问答栏在 1512×900 上能滚的只有约 170px（片 b 量的），时间单占一行的话三张卡就是一整屏 ——
        // 原句最多两行，再长的截掉（点过去就听得到全句）
        const words = (
          <>
            <span className="block text-[1em] leading-[1.7143]">
              <span aria-hidden className={`ui-mono mr-1.5 text-[0.8229em] ${r.ok ? "text-teal-300" : "text-ink-500"}`}>
                {at === null ? "--:--" : mmss(at)}
              </span>
              {at !== null && (
                <span aria-hidden className="mr-1.5 text-[0.7086em] text-ink-500">
                  {at >= fromS ? t("watch.qa.refLater") : t("watch.qa.refEarlier")}
                </span>
              )}
              <span className={`font-chat ${r.ok ? "text-ink-100" : "text-ink-300"}`}>{r.note}</span>
            </span>
            {quote && (
              <span className="font-chat line-clamp-2 block text-[0.9143em] leading-[1.5625] text-ink-300 [overflow-wrap:anywhere]">
                “{quote}”
              </span>
            )}
          </>
        );
        if (r.ok && r.t_s !== null) {
          const to = r.t_s;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(to)}
                className="block w-full rounded-xl border border-ink-700 px-3 py-1.5 text-left transition-colors hover:border-teal-400 hover:bg-ink-700/30 focus-visible:border-teal-400 focus-visible:outline-none"
              >
                <span className="sr-only">{t("watch.qa.refJump", mmss(to))}</span>
                {words}
              </button>
            </li>
          );
        }
        return (
          <li key={i} className="rounded-xl border border-dashed border-ink-700 px-3 py-1.5">
            {words}
            <span className="mt-0.5 block text-[0.8em] leading-[1.4286] text-ink-500">{t("watch.qa.refUnverified")}</span>
          </li>
        );
      })}
    </ul>
  );
}

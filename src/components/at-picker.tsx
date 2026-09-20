"use client";

import { useEffect, useRef } from "react";
import { useCopy } from "@/components/copy-provider";
import type { AtEntry } from "@/lib/at-time";
import { mmss } from "@/lib/time";

// M3.15 片 d —— 打一个 `@`，输入框上方浮出来的那张单子（计划 §J / **D69**）。
//
// 单子里是什么、怎么排，全在 `lib/at-time.ts` 的 `atEntries`（纯函数、有单元测试）；
// 这里只管长相和点击。**来源就是 `interrupts`，和问题列表同一份数据** —— 不另存一份。
//
// ── 两条脾气，别改 ─────────────────────────────────────────────────────────
// ① **点一条只改输入框，不动视频**（计划 §J）。创始人自己把道理说完整了：
//    「因为是不是想动了，我们 capture 那个轴上就可以点击调整？」——
//    `@` ＝ 只问不动；**点点条** ＝ 要动就点它。两个入口各管一件事，别让它们抢。
//    所以这张单子里**一个 seek 都没有**，也就不该留返回牌（D63）。
// ② **青色在这一页只答「能点 / 是个捕获点」**（一物一义）。所以单子里的时间是青的（点得动），
//    「停过，没问」那半句是灰的（它是说明，不是可点的东西）。

/** 一条的高度靠内容撑；整张单子最高这么多，再多在里面滚 —— 右栏本来就只有两三百像素高 */
const LIST_MAX = "max-h-44";
/**
 * **自动弹的那一次矮一半**（`max-h-20` ≈ 两条半）。
 * 理由是 lab 页上看出来的：他刚问完第一句，答案正要读，一张 236px 的单子弹出来把答案挤成一条缝 ——
 * 那不是「让用户知道」，那是挡路。他自己打 `@` 的时候要的是**挑得准**，用整张；
 * 自动弹的那次要的是**认得出有这么回事**，两条半就够，而且底下那行「自己敲也行」照样露着。
 */
const LIST_MAX_INTRO = "max-h-20";

export function AtPicker({
  entries,
  nowS,
  intro,
  onPick,
  onNow,
  onClose,
  anchorRef,
}: {
  entries: readonly AtEntry[];
  /** 「@现在」那一行写第几秒 */
  nowS: number;
  /** 这一次是**自动弹的那一次**（第一次问完之后），要多带一行说明（计划 §J「怎么让用户知道」⒝） */
  intro: boolean;
  /** 选了一个时间点（传 `MM:SS` 那个串 —— 写回输入框的就是它，所见即所得） */
  onPick: (label: string) => void;
  /** 「@现在」：把 `@…` 从输入框里摘掉，回到默认的「问此刻」 */
  onNow: () => void;
  onClose: () => void;
  /** 输入框本体 —— 点在它身上不算「点到外面」（不然打一个 `@` 单子就自己关了） */
  anchorRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useCopy();
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * 点到外面就关。
   *
   * ⚠️ 用 `pointerdown` 不用 `click`：点在单子外面那一下，`click` 要等到抬起才来，
   * 中间输入框已经被抢走焦点、单子在闪。也**不能**拿输入框的 `onBlur` 来关 ——
   * 点单子里一条的那一下就会先 blur，于是单子在他手指落下的瞬间消失（lab 页上撞过一模一样的）。
   */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (!el) return;
      if (boxRef.current?.contains(el)) return;
      if (anchorRef.current?.contains(el)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose, anchorRef]);

  return (
    <div
      ref={boxRef}
      role="listbox"
      aria-label={t("watch.at.aria")}
      // ⚠️ **这一段是量出来的，别照"看着差不多"改**（lab 页 1512×900 和 1280×680 两档都量过）。
      // 三版才对：
      // ① 在流里、可压缩 → flex 把它压扁，`overflow-hidden` 把最后一条和「自己敲也行」**齐齐切掉**；
      // ② 在流里、`shrink-0` → 单子全了，但**输入框和「发送」被顶出屏幕下沿 31px**
      //    （按钮看不见比单子少一条严重得多；这个项目 2026-09-13 已经栽过一次"按钮被挤出视野"）；
      // ③ 在流里、可压缩 + 列表吃掉压缩 → 1512×900 好看，**1280×680 上整张单子被压成 36px、列表 0px**
      //    ——因为消息流是 `flex-1`（basis 0%），flex 分配压缩量时它权重为 0，**一点都不肯让**，
      //    于是全压在单子头上。
      // 所以改成**浮层**：绝对定位、贴着输入条上沿往上长（`bottom-full`），
      // 压根不参与 flex 分配 —— 输入框一个像素都不会动，单子也永远是完整的。
      // 计划 §J 的原话本来就是「输入框上方**浮出**一张单子」，这才是它说的那个东西。
      // `inset-x-0` 跟着输入条的宽度走（右栏最窄 181px 那一档也不会被切边）；`z-20` 压住下面的聊天。
      // 阴影用 `ink-900/70`：调色板里最深的一档就是 `ink-900`（`ink-950` 根本不存在，
      // `next.config.ts` 的守门当场拦下了 —— 那正是它 2026-09-19 上岗要防的事）
      className="absolute inset-x-0 bottom-full z-20 mb-1 flex max-h-64 flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-lg shadow-ink-900/70"
    >
      {/* 自动弹的那一次多带一行说明 —— **只此一次**，关掉就再也不自动弹（记在 user_settings） */}
      {intro && (
        <p className="shrink-0 border-b border-ink-700 px-3 py-2 text-[0.68rem] leading-5 text-ink-300">
          {t("watch.at.intro")}
        </p>
      )}

      {/* 「@现在」：默认就是它，不打 `@` 也是它 */}
      <button
        type="button"
        role="option"
        aria-selected={false}
        onClick={onNow}
        className="flex w-full shrink-0 items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-ink-700/60"
      >
        <span className="ui-mono shrink-0 text-[0.72rem] text-teal-300">{t("watch.at.now", mmss(nowS))}</span>
        <span className="truncate text-[0.66rem] text-ink-500">{t("watch.at.nowHint")}</span>
      </button>

      {entries.length > 0 && <div className="shrink-0 border-t border-ink-700" />}

      <div className={`${intro ? LIST_MAX_INTRO : LIST_MAX} min-h-0 flex-auto overflow-y-auto`}>
        {entries.map((e) => (
          <button
            key={`${e.tS}`}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(mmss(e.tS))}
            className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-ink-700/60"
          >
            <span className="ui-mono shrink-0 text-[0.72rem] text-teal-300">@{mmss(e.tS)}</span>
            {e.question ? (
              // 问过的：带问题原文。一行放不下就截断 —— 单子是拿来认路的，不是拿来读的
              <span className="truncate text-[0.68rem] text-ink-300">{e.question}</span>
            ) : (
              // 停过没问的：创始人自己点名要的那一类
              <span className="shrink-0 text-[0.68rem] text-ink-500">{t("watch.at.paused")}</span>
            )}
          </button>
        ))}
      </div>

      {/* 「自己敲也行」—— 计划 §J 那张图最后一行。空单子的时候它就是唯一的出路，所以永远在 */}
      <p className="shrink-0 border-t border-ink-700 px-3 py-1.5 text-[0.62rem] leading-5 text-ink-500">
        {entries.length === 0 ? t("watch.at.empty") : t("watch.at.typeHint")}
      </p>
    </div>
  );
}

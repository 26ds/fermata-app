"use client";

import { useMemo, useRef, useState } from "react";
import { segmentLine, spanAt, spanOf, type TermSpan } from "@/lib/segment";
import type { PhraseItem } from "@/lib/phrases/types";

// M3.10 手动选词 —— 一行字幕，**他自己划一段收进词库**（D45）。
//
// 为什么有这个组件：整片 AI 自动扫描 2026-08-02 第一次在生产跑通，标出 19 条，
// 逐条读回来**约一半是噪音**。创始人的结论不是"把提示词调准一点"，是换路：
// **「哪个词我不懂」这件事只有他自己知道**，AI 猜永远隔一层，还花钱、要等、会标错。
//
// 交互定死在 M3.10-plan §A：**点两下选一段**。
//   点第一个词 → 就地长出「收下 / 取消」，选中的就是这一个词
//   再点另一个词 → 选中**这两个之间的整段**（中间的空格标点照样包含）
//   取消 / 换一行 → 干干净净退出，什么都没存
// **不用手机原生的长按拖拽**：在一条 375px 宽的字幕上对齐那两个小手柄，是注定被骂的交互。
//
// D18：那条「收下 / 取消」**就地长在这一行下面**，不做浮层 —— 手机上浮层会被
// 磨砂层、面板、悬浮球轮流盖住（M3.7 已经踩过一次）。

/** D42：文案集中在顶部，M3.9 抽语言表时只动这一处 */
const COPY = {
  take: "收下",
  // 真机反馈 2026-08-04：「我并没有看到中文解释，测试了很多个视频」。
  // 探针证明解释**生成得出来**（同一句话、同一个词，Gemini 三种模式都给了中文）——
  // 错在我只把它写进了词库那一页，**他点词的地方从头到尾什么都不说**。
  // 他点一个词就是在问"这什么意思"，答案必须落在他手指下面
  glossBusy: "查这个词的意思…",
  glossFailed: "没查到意思",
  glossRetry: "再试一次",
  glossDismiss: "收起",
  saved: "已收进词库",
  // **动词必须排在最前面**：第一版是「〔词〕已在词库 · 去掉」，划了一长段之后按钮被
  // 截断成「〔about machine learning is t…」—— 这句话到底让人干什么，全被吃掉了。
  // 选中的原文就在正上方高亮着，不必在按钮里再抄一遍
  drop: "已在词库 · 去掉",
  cancel: "取消",
  hint: "再点一个词 = 选中中间整段",
  word: (t: string) => `选中「${t}」`,
};

/** 一个刚收下的词，它的解释取到哪一步了 */
export interface GlossState {
  status: "busy" | "ready" | "failed";
  text: string;
}

export interface SelectableLineProps {
  /** 这一行的原文 */
  text: string;
  /** 字幕段下标 —— 存 atom 时要用（`PhraseItem.i`，父组件靠它取 `context_quote`） */
  i: number;
  /** 这一段的起始秒 —— 词库里点一下跳回原声，靠的就是它 */
  t: number;
  /** 这条内容是什么语言。**D42：切块的 locale 用它，不许假设英文** */
  contentLang?: string | null;
  /** AI 标出来的那一段（可能没有）。手动划的和它**共用同一套视觉**，别让人看出"两种词" */
  phrase?: PhraseItem;
  /** 这一行里已经在词库里的那些词的位置（父组件用 `findTerms` 算好传进来） */
  savedSpans?: TermSpan[];
  /** 收下 / 去掉一段。手动划的会现造一个 `PhraseItem`（`gloss` 先留空，后台补） */
  onToggleTerm?: (phrase: PhraseItem) => void;
  /** 刚收下的那些词，解释取到哪一步了（`词 → 状态`）。父组件管，两个入口共用一份 */
  glosses?: Map<string, GlossState>;
  /** 没取到时人点的重试。**代码永远不自动重试**（D44：花钱只由人点） */
  onRetryGloss?: (term: string) => void;
  /**
   * M3.11：**悬浮 / 长按一个阴影词**要查词（气泡状态在最外层一处，不是每行一个）。
   * `rect` 是那个词在视口里的位置 —— 气泡靠它把尖角对准这个词。
   */
  onLookup?: (term: string, rect: DOMRect, contextQuote: string) => void;
  /** 鼠标离开那个词。关不关由外层决定（要留一口气让鼠标移进气泡里） */
  onLookupLeave?: () => void;
  /** 关掉划词。字幕列表里"点一行跳到那一秒"要用（两个手势不能同时在一行上） */
  canSelect?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function SelectableLine({
  text,
  i,
  t,
  contentLang,
  phrase,
  savedSpans = [],
  onToggleTerm,
  glosses,
  onRetryGloss,
  onLookup,
  onLookupLeave,
  canSelect = true,
  className,
  style,
}: SelectableLineProps) {
  /** `[锚点, 另一头]`。第一次点只有锚点，此时两头相同 = 只选中那一个词 */
  const [sel, setSel] = useState<{ anchor: number; other: number } | null>(null);
  /** 刚收下的那个词 —— 它的解释就长在这一行下面。收起 = 置空 */
  const [answer, setAnswer] = useState<string>("");

  // 切块只在行文本（或语言）变了时重算。**字幕层是 250ms 的热路径，绝不能每帧重切**
  const { blocks, mode } = useMemo(() => segmentLine(text, contentLang), [text, contentLang]);

  // 换了一行、或划词被关掉 → 上一轮的选中作废。
  // 渲染期校正而不是 effect：用 effect 会先闪一帧"上一行的选中态跑到这一行来了"
  const [seen, setSeen] = useState<{ text: string; canSelect: boolean }>({ text, canSelect });
  if (seen.text !== text || seen.canSelect !== canSelect) {
    setSeen({ text, canSelect });
    if (sel) setSel(null);
    if (answer) setAnswer("");
  }

  const lo = sel ? Math.min(sel.anchor, sel.other) : -1;
  const hi = sel ? Math.max(sel.anchor, sel.other) : -1;
  const picked = sel ? spanOf(text, blocks, sel.anchor, sel.other) : null;

  // AI 标的那一段也当成"一段已知的区间"来画 —— 和手动收的走同一套上色逻辑，
  // 于是用户看到的只有两种状态：**这个我收了 / 这个被建议了**，没有"来源"这种概念
  const aiSpan: TermSpan | null =
    phrase && phrase.start >= 0 && phrase.start < text.length
      ? { start: phrase.start, end: phrase.start + phrase.text.length, term: phrase.text }
      : null;

  /** 这个字符区间已经是个"整体"了吗（已收进词库的、或 AI 标出来的） */
  const knownAt = (start: number, end: number): TermSpan | null =>
    spanAt(savedSpans, start, end) ??
    (aiSpan && start < aiSpan.end && end > aiSpan.start ? aiSpan : null);

  // ── M3.11 长按查词的三个 ref ────────────────────────────────────
  /** 长按计时器 */
  const pressTimer = useRef<number | null>(null);
  /** 手指按下的位置 —— 挪超过 10px 就说明他在滚字幕，不是在查词 */
  const pressFrom = useRef<{ x: number; y: number } | null>(null);
  /**
   * 长按已经触发过了 → **把紧跟着的那一下 click 吞掉**。
   * 不吞的话，长按查完词、手一松，这个词又被"选中"了（M3.10 的点选手势）。
   */
  const pressFired = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressFrom.current = null;
  };

  /** 长按判定多久。太短会和"点一下选词"打架，太长手指会先松开 */
  const LONG_PRESS_MS = 450;
  const MOVE_TOLERANCE = 10;

  const tapBlock = (k: number) => {
    setSel((prev) => {
      if (prev) return { anchor: prev.anchor, other: k };
      // 点在一个**已经成段**的词上（已收的 / AI 标的）→ 直接整段选中，
      // 而不是只选中被点的那一个词。否则"点一下已收的词想去掉它"会变成
      // "把里面的一个词又单独收一遍"，词库里立刻多出一条重复的
      const known = knownAt(blocks[k].start, blocks[k].end);
      if (!known) return { anchor: k, other: k };
      let a = k;
      let b = k;
      for (let j = 0; j < blocks.length; j++) {
        if (blocks[j].start < known.end && blocks[j].end > known.start) {
          if (j < a) a = j;
          if (j > b) b = j;
        }
      }
      return { anchor: a, other: b };
    });
  };

  const commit = () => {
    if (!picked || !onToggleTerm) return;
    onToggleTerm({ i, t, start: picked.start, text: picked.text, gloss: "" });
    // 收完就退出选中态。**不退的话，米色的选中高亮正好盖住刚变青的那一段**，
    // 于是唯一的"收进去了"的反馈被自己挡住了。退出来他才看得见那一段变了色。
    // 反悔也不难：再点那个词，整段会被重新选中，按钮那时写的是「去掉」
    setSel(null);
    // 收下（不是去掉）之后，**解释就长在这一行下面** —— 他点这个词就是在问它什么意思，
    // 让他跑去另一页才看得到答案，等于没回答
    setAnswer(pickedSaved ? "" : picked.text);
  };

  const pickedSaved = picked ? savedSpans.some((s) => s.term === picked.text) : false;

  return (
    <div className={className} style={style}>
      {/* whitespace-pre-wrap：每一块都是独立的 inline 元素，不这么写行首行尾的空格会被吃掉，
          "hang in there" 就会显示成 "hangin there" */}
      <span className="whitespace-pre-wrap break-words">
        {blocks.map((b, k) => {
          const inSel = sel !== null && k >= lo && k <= hi;
          const saved = spanAt(savedSpans, b.start, b.end);
          const ai = !saved && aiSpan && b.start < aiSpan.end && b.end > aiSpan.start ? aiSpan : null;

          // 上色优先级：正在选 > 已收进词库 > AI 建议 > 普通文字。
          // **普通文字一点装饰都不加** —— 一整行铺满小方块只会让人不敢读
          // 正在选的那一段用**米色荧光笔**，不用青色：第一版两个都是青的（选中 /35、
          // 已收 /85），挂上去一看**根本分不出"我正在选"和"这个早就收过了"**。
          // 换个色族就一目了然。彩底上的文字用同族最深色（globals.css 的规矩）
          let tone = "";
          if (inSel) tone = "bg-ink-100 text-ink-900";
          else if (saved) tone = "bg-teal-400/85 text-teal-950";
          else if (ai) tone = "bg-teal-400/15 text-teal-300 underline decoration-teal-400/60 decoration-dotted underline-offset-4";

          // 圆角只给区间的两头，中间保持方角，几块连起来才是一整条而不是一串药丸
          const range = inSel ? { start: blocks[lo].start, end: blocks[hi].end } : (saved ?? ai);
          const edge = range
            ? `${b.start <= range.start ? "rounded-l-[0.2rem] pl-0.5" : ""} ${
                b.end >= range.end ? "rounded-r-[0.2rem] pr-0.5" : ""
              }`
            : "";

          if (!b.selectable || !canSelect || !onToggleTerm) {
            return (
              <span key={k} className={`${tone} ${edge}`}>
                {b.text}
              </span>
            );
          }
          // M3.11：**只有阴影词能查**（创始人 2026-08-04 拍板）。
          // 它们的「当前语境意思」本来就存在库里 —— 所以查词才可能"秒出现"
          const shaded = Boolean(saved ?? ai);
          const lookHere = (el: HTMLElement) =>
            onLookup?.(shaded ? (saved ?? ai)!.term : b.text, el.getBoundingClientRect(), text);

          return (
            <span
              key={k}
              role="button"
              tabIndex={0}
              aria-pressed={inSel}
              aria-label={COPY.word(b.text)}
              // ── 鼠标：**移上去立刻出**（他要"秒出现"，不加 hover 延迟）──
              onPointerEnter={
                shaded && onLookup
                  ? (e) => {
                      // 只认真鼠标。触摸屏上 pointerenter 也会在按下时触发，
                      // 那会变成"轻轻一碰就弹气泡"，把长按这条路彻底盖掉
                      if (e.pointerType === "mouse") lookHere(e.currentTarget);
                    }
                  : undefined
              }
              onPointerLeave={
                shaded && onLookup
                  ? (e) => {
                      if (e.pointerType === "mouse") onLookupLeave?.();
                      cancelPress();
                    }
                  : undefined
              }
              // ── 触摸/触控笔：长按 450ms ──
              onPointerDown={
                shaded && onLookup
                  ? (e) => {
                      if (e.pointerType === "mouse") return;
                      pressFired.current = false;
                      pressFrom.current = { x: e.clientX, y: e.clientY };
                      const el = e.currentTarget;
                      pressTimer.current = window.setTimeout(() => {
                        pressFired.current = true;
                        lookHere(el);
                      }, LONG_PRESS_MS);
                    }
                  : undefined
              }
              onPointerMove={
                shaded && onLookup
                  ? (e) => {
                      const from = pressFrom.current;
                      if (!from) return;
                      // 手指在动 = 他在滚字幕，不是在查词
                      if (
                        Math.abs(e.clientX - from.x) > MOVE_TOLERANCE ||
                        Math.abs(e.clientY - from.y) > MOVE_TOLERANCE
                      ) {
                        cancelPress();
                      }
                    }
                  : undefined
              }
              onPointerUp={shaded && onLookup ? cancelPress : undefined}
              onPointerCancel={shaded && onLookup ? cancelPress : undefined}
              // 桌面右键 / 安卓长按会弹系统菜单，盖住我们自己的气泡
              onContextMenu={shaded && onLookup ? (e) => e.preventDefault() : undefined}
              onClick={(e) => {
                // 字幕行整行是"点了跳到这一句"，那层在底下 ——
                // 词必须自己接住这一下，别把"我想收这个词"变成"跳走了"
                e.stopPropagation();
                cancelPress();
                // 长按刚查完词，手一松别顺手把这个词选中了
                if (pressFired.current) {
                  pressFired.current = false;
                  return;
                }
                tapBlock(k);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                e.stopPropagation();
                tapBlock(k);
              }}
              // 逐字回落时块很窄（一个字母才几个像素），**撑到 22px 才点得中**。
              // 按词切出来的块本身就够宽，不必撑 —— 撑了反而把一行拉散
              // pointer-events-auto：字幕列表里整行是一层"点了跳到这一句"的覆盖按钮，
              // 正文那一层是 pointer-events-none。词必须自己把点击接回来，
              // 否则点词就变成了跳走（M3.7 给高亮词组也是这么处理的）
              // 阴影词要 `select-none` + `-webkit-touch-callout:none`：
              // 不加的话，**iOS Safari 长按会弹出系统的放大镜和「拷贝」菜单**，
              // 把我们的词卡整个盖住。只加在阴影词上 —— 普通字幕文字照旧可以选中复制
              className={`pointer-events-auto relative z-10 cursor-pointer transition-colors ${tone} ${edge} ${
                mode === "char" ? "inline-block min-w-[22px] text-center" : ""
              } ${inSel ? "" : "hover:bg-teal-400/20"} ${
                shaded && onLookup ? "select-none [-webkit-touch-callout:none]" : ""
              }`}
            >
              {b.text}
            </span>
          );
        })}
      </span>

      {/* D18：就地长出来的那一条。**先出现、再让他改**——第一次点完就能收，
          不必非要点满两下（"点同一个词 = 只要这一个"在这里自然成立） */}
      {picked && onToggleTerm && (
        <div className="pointer-events-auto relative z-10 mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              commit();
            }}
            className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-3 text-xs font-semibold transition-colors ${
              pickedSaved
                ? "border border-teal-400/60 text-teal-300 hover:bg-teal-400/10"
                : "bg-teal-400 text-teal-950 hover:bg-teal-300"
            }`}
          >
            {/* 动词不许被截断（shrink-0），要截就截那段原文 */}
            <span className="shrink-0">{pickedSaved ? COPY.drop : COPY.take}</span>
            {!pickedSaved && <span className="min-w-0 truncate">「{picked.text}」</span>}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSel(null);
            }}
            className="min-h-9 shrink-0 rounded-xl border border-ink-500/60 px-3 text-xs text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300"
          >
            {COPY.cancel}
          </button>
        </div>
      )}
      {picked && onToggleTerm && lo === hi && (
        <p className="mt-1 text-[0.68rem] leading-4 text-ink-500">{COPY.hint}</p>
      )}

      {/* 刚收下的那个词的解释，**就长在这一行下面**（D18：不做浮层）。
          三种状态各说各的（D44）：在查 / 查到了 / 没查到 + 一个人点的重试。
          空着不说话是这次真机反馈的原病根 —— 他连"我在查"都看不到 */}
      {answer && glosses?.get(answer) && (
        <div className="pointer-events-auto relative z-10 mt-1.5 rounded-xl border border-teal-400/40 bg-ink-900/70 px-2.5 py-1.5">
          <p className="flex items-start gap-1.5 text-[0.72rem] leading-5">
            <span className="shrink-0 text-teal-300">✓</span>
            <span className="min-w-0 flex-1 text-ink-100">
              <span className="font-semibold">{answer}</span>
              <span className="text-ink-500"> · </span>
              {glosses.get(answer)!.status === "ready" ? (
                glosses.get(answer)!.text
              ) : (
                <span className="text-ink-500">
                  {glosses.get(answer)!.status === "busy" ? COPY.glossBusy : COPY.glossFailed}
                </span>
              )}
            </span>
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[0.66rem] text-ink-500">{COPY.saved}</span>
            <span className="flex-1" />
            {glosses.get(answer)!.status === "failed" && onRetryGloss && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryGloss(answer);
                }}
                className="min-h-7 shrink-0 rounded-lg border border-teal-400/50 px-2 text-[0.66rem] text-teal-300"
              >
                {COPY.glossRetry}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAnswer("");
              }}
              className="min-h-7 shrink-0 rounded-lg px-2 text-[0.66rem] text-ink-500 hover:text-teal-300"
            >
              {COPY.glossDismiss}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

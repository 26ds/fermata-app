"use client";

import { splitByPhrase, type PhraseItem } from "@/lib/phrases/types";

// M3.7 —— 「一行字幕里高亮一个词组 + 一个打勾」的公共零件（D39 + D40）。
//
// 两个地方要用同一套手感：**暂停面板里那两秒**、**下面整条字幕列表**。
// 各写一份必然走样（一处能勾一处不能、颜色对不上），所以抽出来。
//
// D42：这里不出现任何面向语言的文案 —— 它只管画，说什么由调用方给。

const COPY = {
  save: "收进词库",
  unsave: "从词库去掉",
  saveLine: "收下这一行标出来的",
  saved: "已在词库里",
};

/**
 * 一行字幕的正文：高亮那一段做成可点的按钮（点 = 只收这一个，D40 的细粒度）。
 * 没有高亮就是一段普通文字。
 */
export function PhraseText({
  text,
  phrase,
  saved,
  onToggle,
  className,
  style,
}: {
  text: string;
  phrase?: PhraseItem;
  saved: boolean;
  onToggle?: (phrase: PhraseItem) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { before, hit, after } = splitByPhrase(text, phrase);
  if (!phrase || !hit) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    );
  }
  return (
    <span className={className} style={style}>
      {before}
      <button
        type="button"
        onClick={
          onToggle
            ? (e) => {
                e.stopPropagation();
                onToggle(phrase);
              }
            : undefined
        }
        aria-pressed={saved}
        aria-label={`${saved ? COPY.unsave : COPY.save}：${phrase.text}`}
        title={phrase.gloss}
        // pointer-events-auto：字幕行整行是"点了跳到这一句"，那层覆盖按钮在底下；
        // 词组和 ✓ 必须自己接住点击，别把"我想收这个词"变成"跳走了"
        className={`pointer-events-auto relative z-10 rounded px-0.5 transition-colors ${
          saved
            ? "bg-teal-400/85 text-teal-950"
            : "bg-teal-400/15 text-teal-200 underline decoration-teal-400/60 decoration-dotted underline-offset-4 hover:bg-teal-400/30"
        }`}
      >
        {hit}
      </button>
      {after}
    </span>
  );
}

/**
 * 行尾那个 ✓：收下这一行标出来的（D40 的粗粒度 —— 两种粒度都要留）。
 * 这一行没标出东西就不画，别摆一排点不动的灰勾。
 */
export function PhraseCheck({
  phrase,
  saved,
  onToggle,
}: {
  phrase?: PhraseItem;
  saved: boolean;
  onToggle?: (phrase: PhraseItem) => void;
}) {
  if (!phrase) return null;
  return (
    <button
      type="button"
      onClick={
        onToggle
          ? (e) => {
              e.stopPropagation();
              onToggle(phrase);
            }
          : undefined
      }
      aria-pressed={saved}
      aria-label={saved ? COPY.saved : COPY.saveLine}
      className={`pointer-events-auto relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ${
        saved
          ? "border-teal-400 bg-teal-400 text-teal-950"
          : "border-ink-500/60 text-ink-500 hover:border-teal-400 hover:text-teal-300"
      }`}
    >
      ✓
    </button>
  );
}

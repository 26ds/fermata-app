"use client";

import { useMemo, useState } from "react";
import { firstSentence, segmentsInWindow } from "@/lib/captions";
import { mmss } from "@/lib/time";
import type { InterruptRow, TranscriptSegment } from "@/lib/types";

// M3.5 暂停点回看 —— 把已经攒下的打断点变成「看得见、点得回」的一竖列。
//
// 它和点点条（D19）吃的是同一批数据，只是横竖两种看法：
//   点点条 = 横着的时间轴，密集的点会叠成一簇；
//   这个列表 = 竖着排，**一律逐条列出不合并**（竖着本来就不会叠，合并反而藏信息），
//   但排序、时间格式、删除入口必须与点点条一致 —— 同一批数据别在两个地方长得不一样。
//
// 右侧不放视频帧、放「那一刻的字幕文字」：D21 跨域墙 —— YouTube 是 iframe 抓不到帧、
// 播客根本没画面。字幕是全站地基，每条内容都有，而且文字比一帧画面更能唤起当时在听什么。
//
// D35：这里是「暂停点 = 复习燃料」的第一个可见出口，M4 学习模式吃的就是这批数据。

/** 这个列表要的字段 —— 比点点条多「一句话为什么停」和完整问答所需的两列 */
export type PausePoint = Pick<
  InterruptRow,
  "id" | "t_s" | "question_mode" | "question" | "ai_answer"
>;

/** 「那一刻的字幕」取这一刻前后各几秒。够唤起记忆即可，多了会把每行撑成一段文章 */
const CAPTION_BEFORE_S = 4;
const CAPTION_AFTER_S = 4;

/**
 * 「为什么在这儿停」的三档降级，**顺序不许跳档**：
 *  ① 有问题 → 问题原文（最真实，用户自己写的）
 *  ② 只有答案没问题（理论上不该出现，防御性）→ 答案首句
 *  ③ 纯捕获什么都没问 → 那一刻的字幕首句兜底
 * 再兜不住（这条内容还没字幕）才认命说一句大白话。
 * 「用 flash 生成 ≤15 字摘要」是可选增强，本片不做 —— 要花钱、要新路由，字幕首句已经够用。
 */
function reasonOf(
  p: PausePoint,
  caption: string,
): { label: string; text: string; fromCaption: boolean } {
  const q = p.question?.trim();
  if (q) return { label: "问了", text: q, fromCaption: false };
  const a = p.ai_answer?.trim();
  if (a) return { label: "答过", text: firstSentence(a), fromCaption: false };
  if (caption) return { label: "停在这句", text: firstSentence(caption), fromCaption: true };
  return { label: "", text: "只是停了一下", fromCaption: false };
}

interface PauseListProps {
  points: PausePoint[];
  /** 已加载的字幕。null = 还没转出来，右侧字幕行就空着（不显示占位骨架） */
  transcript: TranscriptSegment[] | null;
  /** 沉浸聊天聊过多少轮。0 = 没聊过，顶部那一行就不出现 */
  chatRounds: number;
  /** 点一行：跳到那一秒并把画面滚回视频（父组件负责滚） */
  onSeek(t: number): void;
  onDelete(id: string): Promise<void>;
  /** 打开沉浸聊天看历史 */
  onOpenChat(): void;
}

export function PauseList({
  points,
  transcript,
  chatRounds,
  onSeek,
  onDelete,
  onOpenChat,
}: PauseListProps) {
  // 默认展开：创始人要的是「点进一条内容就看见列出来的每一个暂停节点」。
  // 它排在点点条下方、视频下方，展开不占画面（D18 不受影响），想清爽可以收起来。
  const [open, setOpen] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // 与点点条同一口径：按时间升序
  const sorted = useMemo(() => [...points].sort((a, b) => a.t_s - b.t_s), [points]);
  const segments = transcript ?? [];

  async function remove(id: string) {
    setBusyId(id);
    setError("");
    try {
      await onDelete(id);
      if (expandedId === id) setExpandedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "没删掉，请重试");
    } finally {
      setBusyId(null);
    }
  }

  // 既没停过也没聊过：什么都不画。空态提示点点条那儿已经有一句了，别重复啰嗦
  if (sorted.length === 0 && chatRounds <= 0) return null;

  return (
    <section aria-labelledby="pauselist-title" className="mt-1">
      <div className="flex items-center justify-between px-1">
        <p id="pauselist-title" className="eyebrow">
          replay / 暂停点回看
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ui-mono min-h-11 rounded-xl px-2 text-[0.68rem] text-ink-500 transition-colors hover:text-teal-300"
        >
          {open ? "收起 ⌃" : `展开 ⌄ ${sorted.length}`}
        </button>
      </div>

      {open && (
        <div className="mt-1 overflow-hidden rounded-2xl border border-ink-700">
          {/* 沉浸聊天是「整条内容一条对话」，不锚在某一秒 —— 所以单独占一行放在最上面，
              不混进底下按时间排的列表（D33：两者分家，界面上也别糊在一起）。 */}
          {chatRounds > 0 && (
            <button
              type="button"
              onClick={onOpenChat}
              className="flex min-h-14 w-full items-center gap-3 border-b border-ink-700 bg-ink-900/40 px-4 text-left transition-colors hover:bg-ink-700/40"
            >
              <span className="text-base text-teal-300" aria-hidden>
                ◎
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-100">
                和这条内容聊过 {chatRounds} 轮
              </span>
              <span className="shrink-0 text-xs text-ink-500">打开 →</span>
            </button>
          )}

          {sorted.length === 0 ? (
            <p className="px-4 py-4 text-xs leading-5 text-ink-500">
              这条内容你还没停过。看的时候点右下角悬浮球，停下的每一刻都会记在这里。
            </p>
          ) : (
            <ul className="flex flex-col">
              {sorted.map((p) => {
                const caption = segmentsInWindow(
                  segments,
                  p.t_s - CAPTION_BEFORE_S,
                  p.t_s + CAPTION_AFTER_S,
                )
                  .map((s) => s.text)
                  .join(" ")
                  .trim();
                const reason = reasonOf(p, caption);
                // 有完整回答才给展开箭头 —— 这就是 M3 欠的「点回打断点看历史问答」
                const canExpand = Boolean(p.ai_answer?.trim());
                const isOpen = expandedId === p.id;

                return (
                  <li key={p.id} className="border-b border-ink-700/70 last:border-b-0">
                    <div className="flex items-start">
                      {/* 点一行 = 回到原来的观看界面并跳到那一秒（创始人硬约束 2）。
                          不是新播放器、不是弹窗预览 —— 播放器从头到尾就没卸载过 */}
                      <button
                        type="button"
                        onClick={() => onSeek(p.t_s)}
                        aria-label={`跳回 ${mmss(p.t_s)}`}
                        className="flex min-h-14 min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-700/40"
                      >
                        <span
                          className="teal-halo mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-400"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="ui-mono shrink-0 text-sm text-teal-300">
                              {mmss(p.t_s)}
                            </span>
                            {/* 问题原文是这一行最值钱的东西，手机上一行截太狠 —— 给它两行 */}
                            <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-6 text-ink-100">
                              {reason.label && (
                                <span className="text-ink-500">{reason.label} </span>
                              )}
                              {reason.text}
                            </span>
                          </span>
                          {/* 三档降级走到第三档时，上面那一句**本来就是**这段字幕的首句 ——
                              再把整段铺一遍就是同一句话说两遍（真机预览里一眼就难看）。
                              所以只有前两档（有问题 / 有答案）才补这段"那一刻在讲什么"。
                              另：line-clamp 自己就是 -webkit-box，别再叠 `block` —— 会把它压回普通块级、夹不住 */}
                          {caption && !reason.fromCaption && (
                            <span className="mt-1 line-clamp-2 text-xs leading-5 text-ink-400">
                              「{caption}」
                            </span>
                          )}
                        </span>
                      </button>

                      {canExpand && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : p.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "收起" : "展开"} ${mmss(p.t_s)} 的完整问答`}
                          className="mt-1.5 flex h-11 w-8 shrink-0 items-center justify-center text-ink-500 transition-colors hover:text-teal-300"
                        >
                          <span aria-hidden>{isOpen ? "⌃" : "⌄"}</span>
                        </button>
                      )}

                      {/* 删除：与点点条同一个入口口径，删完两处一起没（同一份 points state） */}
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => remove(p.id)}
                        aria-label={`删除 ${mmss(p.t_s)} 这个暂停点`}
                        className="mr-1 mt-1.5 flex h-11 w-9 shrink-0 items-center justify-center text-ink-500 transition-colors hover:text-red-300 disabled:opacity-40"
                      >
                        {busyId === p.id ? "…" : "✕"}
                      </button>
                    </div>

                    {isOpen && (
                      <div className="border-t border-ink-700/70 bg-ink-900/40 px-4 py-3">
                        {p.question?.trim() && (
                          <p className="text-sm leading-6 text-ink-100">
                            <span className="text-ink-500">你问：</span>
                            {p.question.trim()}
                          </p>
                        )}
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-300">
                          {p.ai_answer?.trim()}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <p role="alert" className="border-t border-ink-700/70 px-4 py-2 text-xs text-teal-300">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

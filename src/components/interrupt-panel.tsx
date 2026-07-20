"use client";

import { useEffect, useState } from "react";
import { mmss } from "@/lib/time";
import type { QuestionMode } from "@/lib/types";

// M1c — 打断面板（壳）。三个 chip 只把"卡在哪一类"记下来，**不请求 AI**。
// AI 回答是 M3：那时拿这一行的 window_start_s / window_end_s 去截转写就行，不用改表。

const CHIPS: { mode: QuestionMode; label: string; hint: string }[] = [
  { mode: "word", label: "这个词啥意思", hint: "有个词没听懂" },
  { mode: "concept", label: "解释这个概念", hint: "整段没跟上" },
  { mode: "voice", label: "语音提问", hint: "想直接开口问（语音稍后接上）" },
];

interface InterruptPanelProps {
  open: boolean;
  /** 这一刻是第几秒 */
  tS: number;
  /** 这一刻是否已经落库：点球触发 = 已记下；暂停触发 = 还没 */
  captured: boolean;
  onPick(mode: QuestionMode): Promise<void>;
  /** 不选类型，只把这一刻记下来（仅未落库时出现） */
  onJustCapture(): Promise<void>;
  onClose(): void;
}

export function InterruptPanel({
  open,
  tS,
  captured,
  onPick,
  onJustCapture,
  onClose,
}: InterruptPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 每次重新打开都清掉上一轮的报错/忙碌态。
  // 用"渲染期校正"而不是 effect —— 免得先渲染出一帧旧状态（也绕开 set-state-in-effect）
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    setError("");
    setBusy(false);
  }

  // 打开时锁住背景滚动 + Esc 关闭
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      // 成功后由父组件关闭面板
    } catch (e) {
      setError(e instanceof Error ? e.message : "没记下来，请重试");
      setBusy(false);
    }
  }

  return (
    // D18：**最多占屏幕下半，绝不遮住视频**。所以这里没有全屏遮罩 ——
    // 遮罩会把画面压暗，而"卡在这一帧上"正是提问的前提，把那一帧盖掉问题就问不出来了。
    // 代价是失去"点空白处关闭"（那需要一层全屏热区，会挡住 YouTube 官方控件），
    // 改由抓手 / 取消 / Esc 三个明确入口关闭。
    // z-60：要盖住 z-50 的悬浮球
    <div className="fixed inset-x-0 bottom-0 z-[60] max-h-[50dvh]">
      <div
        role="dialog"
        aria-labelledby="interrupt-title"
        className="glass flex max-h-[50dvh] flex-col overflow-y-auto rounded-t-3xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.6)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="收起"
          className="mx-auto mb-3 flex h-6 w-16 shrink-0 items-center justify-center"
        >
          <span className="h-1 w-10 rounded-full bg-ink-500/60" aria-hidden />
        </button>

        <p id="interrupt-title" className="text-base font-semibold text-ink-100">
          卡在 <span className="ui-mono text-teal-300">{mmss(tS)}</span>
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-500">
          {captured
            ? "这一刻已经记下了。选一个类型，之后好帮你回答（AI 回答稍后接上）。"
            : "选一个类型，就把这一刻记下来（AI 回答稍后接上）。"}
        </p>

        <div className="mt-3 flex shrink-0 flex-col gap-2">
          {CHIPS.map((c) => (
            <button
              key={c.mode}
              type="button"
              disabled={busy}
              onClick={() => run(() => onPick(c.mode))}
              className="flex min-h-14 shrink-0 items-center justify-between gap-3 rounded-2xl border border-ink-500/60 px-4 text-left transition-colors hover:border-teal-400 disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-100">{c.label}</span>
                <span className="block text-xs text-ink-500">{c.hint}</span>
              </span>
              <span className="shrink-0 text-teal-300" aria-hidden>
                →
              </span>
            </button>
          ))}
        </div>

        {!captured && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(onJustCapture)}
            className="mt-2 min-h-12 w-full shrink-0 rounded-2xl border border-dashed border-ink-500/60 text-sm text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
          >
            只记下这一刻
          </button>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-ink-500/50 bg-ink-700 px-3 py-2 text-sm leading-5 text-teal-300"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 min-h-12 w-full shrink-0 rounded-2xl border border-ink-500/60 text-sm font-semibold text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300"
        >
          取消
        </button>
      </div>
    </div>
  );
}

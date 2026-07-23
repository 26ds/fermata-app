"use client";

import { useEffect, useRef, useState } from "react";
import { mmss } from "@/lib/time";

// M3 打断问答 —— 面板从「只记类型的壳」变成「当场问、AI 扣着字幕答」。
//
// 通用问答，不套教学法（苏格拉底式反问是 M4，教学法唯一来源 SKILL.md）。
// 问答的流式与落库在父组件 + /api/ask 那边做，这里只负责：收问题、显示流式答案。
// D18：半屏玻璃、不遮视频。WORKORDER 材质纪律：玻璃只用于壳，**AI 答案正文实底高对比**。

/** 快捷问：一键把常见困惑问出去，不用打字。语音提问是 Phase-2（长按球接 Live），这里先留个说明 */
const QUICK: { label: string; hint: string; question: string }[] = [
  { label: "解释这段", hint: "整段没跟上", question: "把刚才这段内容讲清楚一点，我没跟上。" },
  { label: "有个词没听懂", hint: "卡在某个词", question: "刚才这段里有没有比较难懂的词或术语？挑出来解释一下。" },
];

interface InterruptPanelProps {
  open: boolean;
  /** 这一刻是第几秒 */
  tS: number;
  /** 这一刻是否已经落库：点球触发 = 已记下；暂停触发 = 还没 */
  captured: boolean;
  /** 正在等 AI 回答 */
  asking: boolean;
  /** 流式答案（边收边长） */
  answer: string;
  /** 回答出错的人话 */
  askError: string;
  /** 问一句（父组件负责：确保这刻已落库 → 流式取 /api/ask） */
  onAsk(question: string): void;
  /** 不问，只把这一刻记下来（仅未落库时出现） */
  onJustCapture(): Promise<void>;
  /** 入口二：进入长问答沉浸聊天（design §C：两个快捷问下方） */
  onEnterImmersive(): void;
  onClose(): void;
}

export function InterruptPanel({
  open,
  tS,
  captured,
  asking,
  answer,
  askError,
  onAsk,
  onJustCapture,
  onEnterImmersive,
  onClose,
}: InterruptPanelProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answerRef = useRef<HTMLDivElement>(null);

  // 每次重新打开都清掉上一轮的输入/报错。渲染期校正，别用 effect（免得先闪一帧旧状态）
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    setInput("");
    setError("");
    setBusy(false);
  }

  // 打开时锁背景滚动 + Esc 关闭
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

  // 答案边长边把视图滚到底，别让新句子长在看不见的地方
  useEffect(() => {
    if (answer && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer]);

  if (!open) return null;

  const submit = (q: string) => {
    const question = q.trim();
    if (!question || asking) return;
    setInput(question);
    onAsk(question);
  };

  async function justCapture() {
    setBusy(true);
    setError("");
    try {
      await onJustCapture();
      // 成功后由父组件关闭面板
    } catch (e) {
      setError(e instanceof Error ? e.message : "没记下来，请重试");
      setBusy(false);
    }
  }

  const showAnswer = asking || answer || askError;

  return (
    // D18：**最多占屏幕下半，绝不遮住视频**（没有全屏遮罩）。抓手 / 取消 / Esc 三个入口关闭。
    // z-60：盖住 z-50 的悬浮球
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
          问一句，我扣着这段字幕答你。
        </p>

        {/* 提问框 */}
        <div className="mt-3 shrink-0">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 桌面：Enter 发送、Shift+Enter 换行。手机走「发送」按钮
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            disabled={asking}
            rows={2}
            placeholder="这里在讲什么？这个词什么意思？"
            className="w-full resize-none rounded-2xl border border-ink-500/60 bg-ink-700/60 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-teal-400 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={asking || !input.trim()}
            onClick={() => submit(input)}
            className="mt-2 min-h-12 w-full shrink-0 rounded-2xl bg-teal-400/90 text-sm font-semibold text-ink-900 transition-colors hover:bg-teal-300 disabled:opacity-40"
          >
            {asking ? "思考中…" : "发送"}
          </button>
        </div>

        {/* 快捷问：不用打字。出答案后收起，把半屏的地方让给答案（D18：面板≤下半屏） */}
        {!showAnswer && (
          <div className="mt-2 flex shrink-0 gap-2">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={asking}
                onClick={() => submit(q.question)}
                className="flex-1 rounded-2xl border border-ink-500/60 px-3 py-2.5 text-left transition-colors hover:border-teal-400 disabled:opacity-50"
              >
                <span className="block text-sm font-semibold text-ink-100">{q.label}</span>
                <span className="block text-xs text-ink-500">{q.hint}</span>
              </button>
            ))}
          </div>
        )}

        {/* 入口二（design §C）：两个快捷问下方的「长问答沉浸聊天」。发现入口，
            克制的流光扫过（immersive-cta），不像广告横幅。点后由父组件扩屏进入。 */}
        {!showAnswer && (
          <button
            type="button"
            disabled={asking}
            onClick={onEnterImmersive}
            className="immersive-cta mt-2 flex w-full shrink-0 items-center gap-3 rounded-2xl border border-ink-500/50 px-4 py-3 text-left transition-colors hover:border-teal-400 disabled:opacity-50"
          >
            <span aria-hidden className="siri-orb flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm text-teal-950">
              ◉
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink-100">长问答沉浸聊天</span>
              <span className="block text-xs leading-4 text-ink-500">有诸多疑惑？进来接着问，我扣着当前进度答。</span>
            </span>
          </button>
        )}

        {/* 答案区（实底高对比，非玻璃 —— WORKORDER 材质纪律） */}
        {showAnswer && (
          <div className="mt-3 shrink-0">
            {askError ? (
              <p
                role="alert"
                className="rounded-2xl border border-ink-500/50 bg-ink-700 px-4 py-3 text-sm leading-6 text-teal-300"
              >
                {askError}
              </p>
            ) : (
              <div
                ref={answerRef}
                className="max-h-[28dvh] overflow-y-auto rounded-2xl bg-ink-700 px-4 py-3 text-sm leading-6 text-ink-100"
              >
                {answer ? (
                  <span className="whitespace-pre-wrap break-words">{answer}</span>
                ) : (
                  <span className="text-ink-500">思考中…</span>
                )}
                {asking && answer && <span className="ml-0.5 animate-pulse text-teal-300">▍</span>}
              </div>
            )}
          </div>
        )}

        {!captured && !showAnswer && (
          <button
            type="button"
            disabled={busy}
            onClick={justCapture}
            className="mt-2 min-h-12 w-full shrink-0 rounded-2xl border border-dashed border-ink-500/60 text-sm text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300 disabled:opacity-50"
          >
            只记下这一刻，先不问
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
          {showAnswer ? "完成" : "取消"}
        </button>
      </div>
    </div>
  );
}

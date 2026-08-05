"use client";

import { useEffect, useRef, useState } from "react";
import { PhraseCheck } from "@/components/phrase-line";
import { SelectableLine, type GlossState } from "@/components/selectable-line";
import { langLabel } from "@/lib/lang";
import type { PhraseItem, ScanDrift } from "@/lib/phrases/types";
import type { TermSpan } from "@/lib/segment";
import { mmss } from "@/lib/time";

// M3 打断问答 —— 面板从「只记类型的壳」变成「当场问、AI 扣着字幕答」。
//
// 通用问答，不套教学法（苏格拉底式反问是 M4，教学法唯一来源 SKILL.md）。
// 问答的流式与落库在父组件 + /api/ask 那边做，这里只负责：收问题、显示流式答案。
// D18：半屏玻璃、不遮视频。WORKORDER 材质纪律：玻璃只用于壳，**AI 答案正文实底高对比**。
//
// === M3.7 / D39 改造：面板从两态变三态 ===
// 创始人指出的矛盾：暂停自动弹出的这块面板**盖住了字幕**，而挑词组恰恰要读字幕。
// 否掉了"做成设置开关"（开关逼人**提前**决定这一场是想问还是想挑词，可意图是逐次变的）。
// 定案是把要读的东西搬进来 + 让面板能缩：
//   展开 —— 顶部多一块「刚才这两秒」（原句 + 高亮词组 + ✓），盖住下面的字幕条无所谓
//   细条 —— 点顶部横杠收成一根，字幕**全露出来**，还能往回翻着勾（验收③）
//   关闭 —— 细条上的 ×、展开态的「取消」、Esc
// ⚠️ 行为变更：横杠原来是"关闭"，现在是"收起"。

/** D42：文案集中在顶部，M3.9 抽语言表时只动这一处 */
const COPY = {
  stuckAt: "卡在",
  askHint: "问一句，我扣着这段字幕答你。",
  lastTwoSeconds: "刚才这两秒",
  // M3.10 / D45：手动选词是主路径，所以入口得说出口 —— 一个没人知道存在的手势等于没做
  pickHint: "点一个词就能收进词库",
  noCaptionHere: "这一刻附近没有字幕。",
  collapse: "点我收起，去看字幕",
  expand: "展开",
  expandLabel: "展开面板",
  close: "关闭",
  askShort: "问一句",
  addWord: "＋词",
  chat: "沉浸聊天",
  rescan: "再扫一次",
  // 扫描的几种结局，每一种都得说人话 —— 说不清楚的失败等于没做
  scanStates: {
    // D45：开关本身搬去「字幕」那一块了（创始人 2026-08-02 指名的位置），
    // 所以这里只剩一句"为什么这片没有高亮"，并把人指过去 —— 面板本来就挤（D18），
    // 同一颗开关不该在两个地方各摆一份（上一轮撤掉重复入口时定的规矩）
    off: "AI 标词关着 —— 开关在下面「字幕」那一行。",
    scanning: "正在把这条内容里值得收的表达标出来…",
    ready: (n: number) => `全片标出 ${n} 个，下面的字幕里也都标了`,
    empty: "整片扫完了，一个都没标出来。",
    "not-ready": "字幕还太少，等它多转出一段再来扫。",
    running: "上一次扫描还没结束（或卡住了）。",
    failed: "这次没扫成。",
  },
  // M3.9：这一份是按**旧的语言设置**扫的。说清楚是哪儿旧了，别只丢一个按钮
  driftMode: "你改过语言设置了 —— 这一份是按之前那套标的。",
  driftSupport: "你换了母语 —— 这些解释还是用之前那门语言写的。",
  driftRescan: "按新的重扫",
  targetTitle: (lang: string) => `这条内容是 ${lang}。`,
  targetQuestion: "你是想学这门语言，还是只想搞懂内容？",
  targetLearn: (lang: string) => `我想学 ${lang}`,
  targetJustContent: "只想搞懂内容",
};

/** 快捷问：一键把常见困惑问出去，不用打字。语音提问是 Phase-2（长按球接 Live），这里先留个说明 */
const QUICK: { label: string; hint: string; question: string }[] = [
  { label: "解释这段", hint: "整段没跟上", question: "把刚才这段内容讲清楚一点，我没跟上。" },
  { label: "有个词没听懂", hint: "卡在某个词", question: "刚才这段里有没有比较难懂的词或术语？挑出来解释一下。" },
];

/** 面板里那两秒的一行字幕 */
export interface PanelLine {
  i: number;
  /** 这一段的起始秒 —— 手动划下来的词也要能跳回原声（M3.10） */
  t: number;
  text: string;
  phrase?: PhraseItem;
  saved: boolean;
  /** M3.10：这一行里已经收进词库的词都在哪儿（父组件用 `findTerms` 算好） */
  savedSpans?: TermSpan[];
}

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

  // ── M3.7 / D39：面板里读字幕、挑词组 ──
  /** `[t−2, t]` 的原句（D39 定死的窗口）。纯前端从已加载的字幕里切，不发请求 */
  lines?: PanelLine[];
  /** 整片扫描的结局 + 标出了几个。**四种失败要分得开**，否则查不出问题 */
  scan?: {
    status: "idle" | "off" | "scanning" | "ready" | "empty" | "not-ready" | "running" | "failed";
    count: number;
  };
  /**
   * M3.9：这一份是按**旧的语言设置**扫的吗（`""` = 没过期）。
   * `"mode"` = 学知识/学语言的判定变了；`"support"` = 解释用的语言变了。
   * 有值时即便扫描是成功的也要给重扫入口 —— 否则改完母语根本没有路重来。
   */
  drift?: ScanDrift;
  /** 「再扫一次」：破锁 + 从头重扫（花钱的动作，所以是一个按钮而不是自动重试） */
  onRescan?: () => void;
  /** 勾 / 取消勾一个词组 */
  onToggleTerm?: (phrase: PhraseItem) => void;
  /** M3.10：刚收下的词，解释取到哪一步了。**答案就长在他点的那一行下面** */
  glosses?: Map<string, GlossState>;
  onRetryGloss?: (term: string) => void;
  /** M3.11：悬浮/长按一个阴影词就查词。气泡在最外层一处，这里只往上报 */
  onLookup?: (term: string, rect: DOMRect, contextQuote: string) => void;
  onLookupLeave?: () => void;
  /** M3.10：这条内容是什么语言 —— 划词切块的 locale 用它（D42：不许假设英文） */
  contentLang?: string | null;
  /**
   * D42：还没问过他"想学这门语言还是只想搞懂内容"。
   * 有值 = 这条内容的语言码，**只问这一次**，答完即定。
   */
  needTargetLang?: string;
  onAnswerTarget?: (learn: boolean) => void;
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
  lines = [],
  scan = { status: "idle", count: 0 },
  drift = "",
  onRescan,
  onToggleTerm,
  glosses,
  onRetryGloss,
  onLookup,
  onLookupLeave,
  contentLang,
  needTargetLang = "",
  onAnswerTarget,
}: InterruptPanelProps) {
  /**
   * 扫成功了、但语言设置后来变了 —— 这一份已经不是他要的那一版。
   * **只在 `ready` 上判**：还在扫的时候提"过期了"只会让人以为出错了。
   */
  const stale = drift !== "" && scan.status === "ready";

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // D39：收成细条。**每次重开都回到展开** —— 上次收起来了不代表这次也想收着
  const [collapsed, setCollapsed] = useState(false);
  const answerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** 横杠上手指按下的位置 —— 往下拖 30px 以上就收起（D39：下拉收成细条） */
  const dragFromRef = useRef<number | null>(null);

  // 每次重新打开都清掉上一轮的输入/报错。渲染期校正，别用 effect（免得先闪一帧旧状态）
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    setInput("");
    setError("");
    setBusy(false);
    setCollapsed(false);
  }

  // 展开时锁背景滚动 + Esc 关闭。
  // **收成细条时不锁** —— 细条的全部意义就是让人去翻下面那条字幕列表（D39 验收③）
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    if (!collapsed) document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, collapsed, onClose]);

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

  // D39 细条：只留「问一句」「＋词」「×」，其余全让给字幕
  if (collapsed) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div role="dialog" aria-label="打断面板（已收起）" className="glass flex items-center gap-1.5 rounded-2xl px-2.5 py-2">
          {/* 带字的胶囊，不是一根光秃秃的横线 —— 一条没标注的细线没人知道它能点 */}
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label={COPY.expandLabel}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-xl border border-ink-500/60 px-2.5 text-xs text-ink-100 transition-colors hover:border-teal-400 hover:text-teal-300"
          >
            <span aria-hidden>▲</span>
            <span className="ui-mono text-teal-300">{mmss(tS)}</span>
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              setCollapsed(false);
              // 展开后把光标送进输入框 —— 少一次点击
              window.setTimeout(() => inputRef.current?.focus(), 60);
            }}
            className="min-h-9 shrink-0 rounded-xl border border-ink-500/60 px-2.5 text-xs text-ink-100 hover:border-teal-400 hover:text-teal-300"
          >
            {COPY.askShort}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="回到暂停那两秒挑词"
            className="min-h-9 shrink-0 rounded-xl border border-ink-500/60 px-2.5 text-xs text-ink-100 hover:border-teal-400 hover:text-teal-300"
          >
            {COPY.addWord}
          </button>
          {/* 创始人真机反馈：细条上得能直接进沉浸聊天。
              收起状态下悬浮球可能正被这条挡着，而"长按球"本来就是个不好发现的动作 */}
          <button
            type="button"
            onClick={onEnterImmersive}
            aria-label={COPY.chat}
            className="siri-orb flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm text-teal-950"
          >
            <span aria-hidden>◉</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={COPY.close}
            className="flex h-9 w-7 shrink-0 items-center justify-center rounded-xl text-base text-ink-500 hover:text-teal-300"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    // D18：**最多占屏幕下半，绝不遮住视频**（没有全屏遮罩）。抓手 / 取消 / Esc 三个入口关闭。
    // z-60：盖住 z-50 的悬浮球
    <div className="fixed inset-x-0 bottom-0 z-[60] max-h-[50dvh]">
      <div
        role="dialog"
        aria-labelledby="interrupt-title"
        className="glass flex max-h-[50dvh] flex-col overflow-y-auto rounded-t-3xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.6)]"
      >
        {/* D39：横杠改成「收起成细条」（原来是关闭）。点一下收，往下拖也收 ——
            要彻底关掉走底下的「取消」或 Esc。**一层层退，不是一脚关到底**（同 D43 的脾气） */}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          onTouchStart={(e) => {
            dragFromRef.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchEnd={(e) => {
            const from = dragFromRef.current;
            dragFromRef.current = null;
            const to = e.changedTouches[0]?.clientY;
            if (from != null && to != null && to - from > 30) setCollapsed(true);
          }}
          className="mx-auto mb-3 flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-ink-500/50 bg-ink-700/60 px-3.5 text-xs text-ink-300 transition-colors hover:border-teal-400 hover:text-teal-300"
        >
          <span aria-hidden>▽</span>
          {COPY.collapse}
        </button>

        {/* 横杠改成"收起"之后，关掉面板本来要滑到最底下按「取消」——
            面板现在更高了（多了那两秒字幕），那等于把"我不想要这个"变成两步。
            右上角补一个 ×，一步关掉的路留着。 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="interrupt-title" className="text-base font-semibold text-ink-100">
              {COPY.stuckAt} <span className="ui-mono text-teal-300">{mmss(tS)}</span>
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-500">{COPY.askHint}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={COPY.close}
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base text-ink-500 transition-colors hover:text-teal-300"
          >
            ×
          </button>
        </div>

        {/* ── D42：只问这一句（内容不是他母语、且从没问过）。答完即定，不再问第二次 ── */}
        {needTargetLang && onAnswerTarget && (
          <div className="mt-3 shrink-0 rounded-2xl border border-teal-400/40 bg-ink-700/70 px-4 py-3">
            <p className="text-sm leading-6 text-ink-100">
              {COPY.targetTitle(langLabel(needTargetLang))}
              <br />
              {COPY.targetQuestion}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onAnswerTarget(true)}
                className="min-h-11 flex-1 rounded-xl bg-teal-400 px-3 text-sm font-semibold text-teal-950 hover:bg-teal-300"
              >
                {COPY.targetLearn(langLabel(needTargetLang))}
              </button>
              <button
                type="button"
                onClick={() => onAnswerTarget(false)}
                className="min-h-11 flex-1 rounded-xl border border-ink-500/60 px-3 text-sm text-ink-100 hover:border-teal-400 hover:text-teal-300"
              >
                {COPY.targetJustContent}
              </button>
            </div>
          </div>
        )}

        {/* ── D39：把要读的东西搬进面板里 ——「刚才这两秒」的原句 + 高亮 + ✓。
            盖住下面的字幕条就无所谓了，因为要读的已经在这儿了。 ── */}
        {!needTargetLang && !showAnswer && (
          <div className="mt-3 shrink-0 rounded-2xl border border-ink-500/50 bg-ink-900/50 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="eyebrow">{COPY.lastTwoSeconds}</p>
              {lines.length > 0 && onToggleTerm && (
                <p className="shrink-0 text-[0.68rem] leading-4 text-ink-500">{COPY.pickHint}</p>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="mt-1.5 text-xs leading-5 text-ink-500">{COPY.noCaptionHere}</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {lines.map((l) => (
                  <li key={l.i}>
                    <div className="flex items-start gap-2">
                      {/* M3.10 / D45：**这几行就是划词的地方**，不另开界面 ——
                          暂停的那一刻正是最想问"这个词什么意思"的时候 */}
                      <SelectableLine
                        text={l.text}
                        i={l.i}
                        t={l.t}
                        contentLang={contentLang}
                        phrase={l.phrase}
                        savedSpans={l.savedSpans}
                        onToggleTerm={onToggleTerm}
                        glosses={glosses}
                        onRetryGloss={onRetryGloss}
                        onLookup={onLookup}
                        onLookupLeave={onLookupLeave}
                        className="min-w-0 flex-1 text-sm leading-9 text-ink-100"
                      />
                      <PhraseCheck phrase={l.phrase} saved={l.saved} onToggle={onToggleTerm} />
                    </div>
                    {/* 解释就跟在它自己那一行下面 —— 两行都标了词的时候，
                        把解释堆在最后会让人对不上是谁的 */}
                    {l.phrase && (
                      <p className="mt-0.5 pl-0.5 text-[0.68rem] leading-4 text-ink-500">
                        {l.phrase.text} · {l.phrase.gloss}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* 扫描到底发生了什么，如实写一行。
                原来这里什么都不说 —— 于是"扫描中闪一下然后没有高亮"可能是四种完全不同的
                原因，用户和我都没法分辨。**说不清楚的失败等于没做。** */}
            {scan.status !== "idle" && (
              <div className="mt-2 flex items-center gap-2 border-t border-ink-500/30 pt-2">
                <p className="min-w-0 flex-1 text-[0.68rem] leading-4 text-ink-500">
                  {scan.status === "ready"
                    ? COPY.scanStates.ready(scan.count)
                    : COPY.scanStates[scan.status]}
                  {/* M3.9：扫成功了但语言设置后来变了 —— 这一份已经不是他要的那一版了。
                      不说这一句的后果 2026-08-02 真机验证过：他改完母语，**根本找不到重扫的入口**，
                      因为按钮只在"扫失败"时出现 */}
                  {stale && (
                    <span className="mt-0.5 block text-teal-300/80">
                      {drift === "support" ? COPY.driftSupport : COPY.driftMode}
                    </span>
                  )}
                </p>
                {/* 只在"扫了却没结果"、"出岔子"、或"语言设置变了"时给重扫 ——
                    它要花钱（D44），不该天天摆着让人随手点。关着的时候更不该有 */}
                {onRescan &&
                  scan.status !== "off" &&
                  (stale ||
                    scan.status === "empty" ||
                    scan.status === "failed" ||
                    scan.status === "running") && (
                    <button
                      type="button"
                      onClick={onRescan}
                      className="min-h-8 shrink-0 rounded-lg border border-teal-400/50 px-2.5 text-[0.68rem] text-teal-300"
                    >
                      {stale ? COPY.driftRescan : COPY.rescan}
                    </button>
                  )}

              </div>
            )}
          </div>
        )}

        {/* 提问框 */}
        <div className="mt-3 shrink-0">
          <textarea
            ref={inputRef}
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

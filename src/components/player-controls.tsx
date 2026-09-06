"use client";

import { useState } from "react";
import { formatRate, RATES, SKIP_STEPS } from "@/lib/play-prefs";

// 共用播放控制条（视频 + 播客同一套壳，创始人 2026-08-01 要的「倍速 + ±10」）。
//
// 三条约束决定了它长这样：
//  ① **不占新的一块地**（D18：纵向空间全是画面的）—— 它挤进播放器下方那条状态胶囊的第二行。
//  ② **不碰播放器 DOM**（D15 合规红线）—— 只经 PlayerHandle 说话，seek 与 setRate 都由观看页转交。
//  ③ **一跳几秒是可改的**：左右两个圆键上写着当前步长，右边那颗「跳 N 秒」按一下摊开 5/10/15/20/30。
//     倍速同理。两个选择盘同一时刻只开一个，且是**就地摊开**不是浮层 ——
//     手机上浮层会被磨砂层、面板、悬浮球轮流盖住，就地长出来的东西不会。

const COPY = {
  back: (n: number) => `后退 ${n} 秒`,
  forward: (n: number) => `前进 ${n} 秒`,
  stepChip: (n: number) => `跳 ${n} 秒`,
  stepMenu: "改成一跳几秒",
  rateMenu: "改播放倍速",
  stepHint: "按一下箭头跳多少秒",
  rateHint: "播放速度（听不清就慢下来）",
  // 还没播过就跳，YouTube 会把封面掀掉又放不出来，只剩一块黑的（2026-08-02 复现）。
  // 所以这时候两颗箭头是灰的 —— 但**必须写清楚为什么**，灰着不说话就是另一种静默失败（D44）
  notStarted: "先点播放，这两颗才跳得动",
};

/**
 * 环形箭头 + 中间的秒数 —— 手机播放器上通用的那个「跳一段」记号，一眼不会读成"重播"。
 *
 * ⚠️ **箭头必须指在"走过来"的方向上**（2026-09-06 创始人报「图标画反了」，属实）。
 * 底稿画的是**逆时针＝后退**：缺口在左上，墨迹从 9 点起绕过底部、沿右侧一路回到 12 点，
 * 所以箭头落在 12 点、**指向左** —— 那正是它下一步要去的地方。
 * 老写法把箭头画成指右，等于让箭头背对着自己的墨迹跑，两个方向就都读反了。
 * **前进＝把整个组照镜子**（缺口翻到右上、箭头指右）。
 * 中间那个数字**故意留在 `<g>` 外面**，不然镜像会把它一起翻过去。
 */
function SkipGlyph({ seconds, forward }: { seconds: number; forward?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className="h-[26px] w-[26px]" aria-hidden focusable="false">
      <g transform={forward ? "translate(32,0) scale(-1,1)" : undefined}>
        <path
          d="M16 5.6a10.4 10.4 0 1 1-10.4 10.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <path d="M19.6 2.1 14.8 5.6 19.6 9.1Z" fill="currentColor" />
      </g>
      <text
        x="16"
        y="20.4"
        textAnchor="middle"
        fontSize="11.5"
        fontWeight="600"
        fill="currentColor"
        style={{ fontFamily: "var(--font-mono-ui)" }}
      >
        {seconds}
      </text>
    </svg>
  );
}

export function PlayerControls({
  step,
  rate,
  onStep,
  onRate,
  onSeekBy,
  canSeek = true,
}: {
  /** 当前步长（秒）。写在两颗箭头里 */
  step: number;
  /** 当前倍速。**以播放器实测为准**，不是我们请求的那个值 —— YouTube 有权不认 */
  rate: number;
  onStep(next: number): void;
  onRate(next: number): void;
  onSeekBy(deltaS: number): void;
  /**
   * 这一次进来画面**真的动过**吗。false 时两颗箭头是灰的并给一行说明 ——
   * 从没播过的 YouTube 播放器一 seek 就整块变黑，且封面回不来（观看页 seekBy 上有全文）。
   */
  canSeek?: boolean;
}) {
  const skipBtn = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
    canSeek
      ? "border-ink-700 text-ink-300 hover:border-teal-400 hover:text-teal-300 active:bg-ink-700/50"
      : "border-ink-700/50 text-ink-500/50"
  }`;
  const [open, setOpen] = useState<"none" | "step" | "rate">("none");
  const toggle = (which: "step" | "rate") => setOpen((o) => (o === which ? "none" : which));

  const chip = (active: boolean) =>
    `min-h-9 rounded-full px-3 text-[0.78rem] font-semibold transition-colors ${
      active
        ? "bg-teal-400 text-teal-950"
        : "border border-ink-700 text-ink-300 hover:border-teal-400 hover:text-teal-300"
    }`;

  return (
    <div className="mt-2.5 border-t border-ink-700/70 pt-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSeekBy(-step)}
          disabled={!canSeek}
          aria-label={COPY.back(step)}
          className={skipBtn}
        >
          <SkipGlyph seconds={step} />
        </button>
        <button
          type="button"
          onClick={() => onSeekBy(step)}
          disabled={!canSeek}
          aria-label={COPY.forward(step)}
          className={skipBtn}
        >
          <SkipGlyph seconds={step} forward />
        </button>

        {!canSeek && (
          <span className="min-w-0 text-[0.68rem] leading-4 text-ink-500">{COPY.notStarted}</span>
        )}

        {/* 两颗设置钮靠右。倍速不是 1 时点亮 —— 忘了自己开着 1.5 倍速然后
            怪"这人怎么说这么快"，是每个播放器都出过的洋相 */}
        <button
          type="button"
          onClick={() => toggle("rate")}
          aria-label={COPY.rateMenu}
          aria-expanded={open === "rate"}
          className={`ui-mono ml-auto min-h-9 shrink-0 rounded-full px-3 text-[0.78rem] font-semibold transition-colors ${
            open === "rate"
              ? "border border-teal-400 text-teal-300"
              : rate !== 1
                ? "border border-teal-400/60 text-teal-300"
                : "border border-ink-700 text-ink-300"
          }`}
        >
          {formatRate(rate)}
        </button>
        <button
          type="button"
          onClick={() => toggle("step")}
          aria-label={COPY.stepMenu}
          aria-expanded={open === "step"}
          className={`min-h-9 shrink-0 rounded-full px-3 text-[0.78rem] transition-colors ${
            open === "step"
              ? "border border-teal-400 text-teal-300"
              : "border border-ink-700 text-ink-300"
          }`}
        >
          {COPY.stepChip(step)}
        </button>
      </div>

      {open !== "none" && (
        <div className="mt-2">
          {/* 说明单独一行：和五个数挤在一行会把 30 挤到第二行去（375px 上量过） */}
          <p className="mb-1.5 text-[0.68rem] text-ink-500">
            {open === "rate" ? COPY.rateHint : COPY.stepHint}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
          {open === "rate"
            ? RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    onRate(r);
                    setOpen("none");
                  }}
                  className={`ui-mono ${chip(r === rate)}`}
                >
                  {formatRate(r)}
                </button>
              ))
            : SKIP_STEPS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onStep(s);
                    setOpen("none");
                  }}
                  className={`ui-mono ${chip(s === step)}`}
                >
                  {s}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

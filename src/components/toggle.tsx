"use client";

// 拨动开关（创始人 2026-08-02 指名要这个形状：一颗滑块在轨道里左右滑）。
//
// 为什么值得单开一个组件：全站在此之前只有「文字按钮」这一种开关形态
// （跟随中／隐藏／原文大…），它们靠**文字变化**表达状态。
// 但「开着还是关着」这件事要能**一眼扫过去就看见**，不该逼人读字 ——
// 尤其这一颗背后是花钱的动作，看错了状态是有代价的。
//
// 颜色照全站那套走（开 = teal-400，和字号滑杆的把手、悬浮球同一个绿），
// **不用系统蓝/橙**。滑块永远是浅色的，靠轨道颜色区分开关，和手机上的原生开关一个读法。

export function Toggle({
  on,
  onChange,
  label,
  id,
}: {
  on: boolean;
  onChange(): void;
  /** 给读屏软件用。图形本身说不出自己管的是什么 */
  label: string;
  /** 想让外面的 <label> 点得动就传一个 */
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-teal-400" : "border border-ink-500/50 bg-ink-700"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-[18px] w-[18px] rounded-full transition-transform ${
          // ⚠️ 滑块颜色只能从调色板里挑（globals.css 只有 ink-900/700/500/300/100 + teal-950/400/300）。
          // 第一版写了 `bg-ink-950` —— 那个色号**根本不存在**，class 静默失效，
          // 开着的时候滑块直接看不见，整颗开关变成一块纯青色的糖。
          // 青底上用同族最深色，是 globals.css 顶上白纸黑字的规矩。
          on ? "translate-x-[23px] bg-teal-950" : "translate-x-[3px] bg-ink-300"
        }`}
      />
    </button>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Lookup } from "@/lib/senses/types";

// M3.11 悬浮词卡 —— 从那个词上"长出来"的玻璃对话框（创始人 2026-08-04 指定的形状）。
//
// 他的原话：「**如同对话框一样从这个词延伸出来**」「对话框的底色应该是玻璃（苹果一样的）材质，
// 上面的字体用和划词阴影一样的颜色」。所以：`.glass`（`backdrop-filter` 连 `-webkit-` 前缀
// 都已经在 globals.css 里了，Safari 现成）+ 一个旋转 45° 的小尖角指着那个词 + 青色字。
//
// **为什么是 `position: fixed`**：字幕列表是个 `overflow-y: auto` 的滚动容器，
// 用 `absolute` 会被它裁掉半个气泡。fixed + `getBoundingClientRect()` 才跑得出容器。
//
// D18：气泡只在字幕/面板那一带弹，**绝不许盖住上方的视频画面**（下面有硬夹取）。

/** D42：文案集中在顶部，M3.9 抽语言表时只动这一处 */
const COPY = {
  loading: "查这个词…",
  failed: "没查到",
  retry: "再试一次",
  otherSenses: "其他常用意思",
  noOther: "没有别的常用意思",
  close: "关掉",
};

/** 气泡离屏幕左右边至少留这么多，375px 上才不会贴边 */
const EDGE = 8;
/** 气泡和那个词之间的缝（尖角就长在这段缝里） */
const GAP = 10;
const BUBBLE_MAX_W = 300;
/** 上方留不下这么高就翻到词的下面去 */
const MIN_ROOM = 120;

export interface BubbleAnchor {
  /** 触发它的那个词在**视口**里的位置（`getBoundingClientRect()` 原样） */
  rect: { top: number; bottom: number; left: number; right: number };
  term: string;
}

export function WordBubble({
  anchor,
  data,
  loading,
  error,
  onRetry,
  onClose,
  /** 鼠标移进气泡里不该让它消失 —— 这两个回调把"还在气泡上"告诉调用方 */
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: BubbleAnchor;
  data: Lookup | null;
  loading: boolean;
  error: string;
  onRetry?: () => void;
  onClose: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean; tail: number } | null>(
    null,
  );

  /**
   * 量完自己的实际高度再定位，**在浏览器画之前**（`useLayoutEffect`）——
   * 用 `useEffect` 的话会先在错的地方闪一帧再跳过去。
   */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = el.offsetHeight;
    const w = Math.min(el.offsetWidth, BUBBLE_MAX_W);

    // 上方放不下就翻到词的下面（贴着屏幕顶部的那一行必然走这条）
    const roomAbove = anchor.rect.top;
    const below = roomAbove < Math.max(h + GAP, MIN_ROOM);
    const top = below ? anchor.rect.bottom + GAP : anchor.rect.top - h - GAP;

    // 左右夹住视口。**先算尖角该在哪，再夹气泡** —— 反过来的话，
    // 气泡被推到边上之后尖角就不指着那个词了
    const center = (anchor.rect.left + anchor.rect.right) / 2;
    const left = Math.min(Math.max(center - w / 2, EDGE), Math.max(EDGE, vw - w - EDGE));
    // 尖角相对气泡左边的位置，两端各留 14px 免得尖角骑在圆角上
    const tail = Math.min(Math.max(center - left, 14), Math.max(14, w - 14));

    setPos({ left, top: Math.min(Math.max(top, EDGE), Math.max(EDGE, vh - h - EDGE)), below, tail });
  }, [anchor, data, loading, error]);

  // 滚动 / 改窗口大小就关掉。**不做跟随重算** —— 字幕层是 250ms 热路径，
  // 而且滚动的时候这个气泡本来就该消失（手指在翻字幕，不是在查词）
  useEffect(() => {
    const bye = () => onClose();
    window.addEventListener("scroll", bye, true); // capture：滚的是里层那个字幕容器
    window.addEventListener("resize", bye);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", bye, true);
      window.removeEventListener("resize", bye);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const senses = data?.senses ?? [];

  // **必须 portal 到 body**（2026-08-04 真机反馈「这个错位了」）：
  // `position: fixed` 只在**没有**祖先带 transform / filter / backdrop-filter 时才相对视口，
  // 而每一页的 `<main class="page-enter">` 上都挂着一段升起动画 —— 详细的实测数据和
  // 为什么整页所有浮层都得这么干，写在 components/viewport-layer.tsx。
  //
  // 这里**不用** <ViewportLayer>：那一层要等挂载后才吐 portal，而气泡第一帧就要靠
  // `boxRef` 量自己的高度来定位，晚一帧 ref 是空的。它只在交互后才出现、不参与服务端
  // 渲染，所以就地 portal 是安全的。
  const node = (
    <div
      ref={boxRef}
      role="tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // z-[70]：盖得过暂停面板（z-60）和悬浮球（z-50）。
      // invisible 而不是 hidden：第一帧要能量到高度，但不许让人看见它在错的地方
      className={`glass-card fixed z-[70] rounded-2xl px-3 py-2.5 ${
        pos ? "" : "invisible"
      }`}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        maxWidth: BUBBLE_MAX_W,
        width: "max-content",
      }}
    >
      {/* 从那个词延伸出来的小尖角：转 45° 的方块，只留朝外的两条边有描边，
          看起来才是气泡的一角而不是贴上去的一个菱形 */}
      {pos && (
        <span
          aria-hidden
          // **只留朝外的那两条边**：转 45° 的方块四条边都描出来，看着就是一颗贴上去的菱形；
          // 只留外侧两条，它才接得上气泡本身那圈描边，像是同一个形状伸出来的一角。
          // 气泡在词上面 → 尖角朝下（外侧 = 右、下）；翻到词下面 → 尖角朝上（外侧 = 左、上）
          className="glass-tail absolute h-3 w-3 rotate-45 rounded-[3px]"
          style={{
            left: pos.tail - 6,
            // -5 而不是 -6：往回缩 1px 压住气泡自己那条边，接缝才看不出来
            [pos.below ? "top" : "bottom"]: -5,
            // ⚠️ 必须写成内联样式：`.glass` 用的是 `border:` 简写，而它在 globals.css 里
            // 排在 Tailwind 之后 —— 同为单类选择器时后来者胜，`border-t-0` 这种工具类**压不动它**。
            // （这一类"class 写了却没生效"是编译器完全看不见的，只有渲染出来看一眼才发现。）
            ...(pos.below
              ? { borderBottomWidth: 0, borderRightWidth: 0 }
              : { borderTopWidth: 0, borderLeftWidth: 0 }),
          }}
        />
      )}

      <div className="relative">
        <p className="flex items-baseline gap-2">
          <span className="min-w-0 break-words text-sm font-semibold text-teal-300">
            {anchor.term}
          </span>
          {data?.context?.pos && (
            <span className="shrink-0 rounded-md bg-teal-400/15 px-1.5 py-0.5 text-[0.62rem] text-teal-300">
              {data.context.pos}
            </span>
          )}
        </p>

        {loading && !data ? (
          <p className="mt-1 text-xs leading-5 text-ink-500">{COPY.loading}</p>
        ) : error && !data ? (
          <p className="mt-1 flex items-center gap-2 text-xs leading-5 text-ink-500">
            <span>{error || COPY.failed}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="min-h-7 shrink-0 rounded-lg border border-teal-400/50 px-2 text-[0.66rem] text-teal-300"
              >
                {COPY.retry}
              </button>
            )}
          </p>
        ) : (
          <>
            {/* 当前语境的意思 —— 大字，这是他悬浮的理由 */}
            {data?.context?.gloss && (
              <p className="mt-1 text-[0.82rem] leading-6 text-teal-100">{data.context.gloss}</p>
            )}

            <div className="mt-2 border-t border-teal-400/20 pt-1.5">
              <p className="text-[0.6rem] uppercase tracking-wider text-teal-400/70">
                {COPY.otherSenses}
              </p>
              {senses.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1">
                  {senses.map((s, k) => (
                    <li key={k} className="flex items-baseline gap-1.5 text-xs leading-5">
                      {s.pos && (
                        <span className="shrink-0 text-[0.62rem] text-teal-400/80">{s.pos}</span>
                      )}
                      <span className="min-w-0 text-teal-300/90">{s.gloss}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                // D44：查了没有 / 没查成，是两句不同的话
                <p className="mt-1 flex items-center gap-2 text-[0.68rem] leading-4 text-ink-500">
                  <span>
                    {loading
                      ? COPY.loading
                      : data?.sensesStatus === "failed"
                        ? error || COPY.failed
                        : COPY.noOther}
                  </span>
                  {data?.sensesStatus === "failed" && onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="min-h-6 shrink-0 rounded-lg border border-teal-400/50 px-1.5 text-[0.62rem] text-teal-300"
                    >
                      {COPY.retry}
                    </button>
                  )}
                </p>
              )}
            </div>
          </>
        )}

        {/* 手机上没有"移开鼠标"，必须有个关得掉的地方 */}
        <button
          type="button"
          onClick={onClose}
          aria-label={COPY.close}
          className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full text-xs text-ink-500 transition-colors hover:text-teal-300"
        >
          ×
        </button>
      </div>
    </div>
  );

  // SSR 那一帧没有 document —— 这个组件只在用户悬浮/长按之后才挂载，
  // 走不到服务端，但仍然守一道，免得将来被搬到别处时炸掉
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

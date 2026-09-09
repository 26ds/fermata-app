"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useCopy, useUiLang } from "@/components/copy-provider";
import { writeUiLangCookie } from "@/lib/ui-lang-shared";

/**
 * M3.9 片 c —— **中 / EN 一键切换**（创始人 2026-09-09：「中英文按钮一键切换所有的
 * 界面语言」「每一个界面都应该有，置顶固定」）。
 *
 * ── 为什么它只切界面，不碰母语 ────────────────────────────────────────────
 * 创始人当天问过这一条，答的是「**只有界面操作语言变化**，AI 输出的答案根据自己
 * 判断（或者用户的输入语言）」。所以这颗按钮写的**只有 `uiLang` 一个键** ——
 * `nativeLang` 一个字都不动（AI 用它解释、译文译成它，那是另一条线，D42 红线）。
 *
 * ── 两段标签为什么不翻译 ──────────────────────────────────────────────────
 * 「中」和「EN」是**语言自己的写法**（endonym）。中文界面里写「中文 / 英文」、
 * 英文界面里写「Chinese / English」看着对，实际是错的：一个只读英文的人在
 * 中文界面上要找的正是「EN」这两个字母，把它写成「英文」他就认不出来了。
 * 语言开关必须用各自的语言写自己 —— `/privacy` 那颗（M3.10 之外，D70 加的）也是这么做的。
 *
 * ── 不登录也要能用 ────────────────────────────────────────────────────────
 * 登录页、`/privacy`、`/terms`、404 都没有会话，PUT 必然 401。
 * **cookie 那一层本来就够撑起整个界面**（`getUiLang` 先读 cookie），
 * 所以 401 不是失败，是这些页面的正常路径 —— 不报错、不打扰。
 *
 * ── 2026-09-09 追加：切换途中必须看得见"在转" ────────────────────────────
 * 创始人原话：「**中英切换的几秒钟要显示加载，加载时刻用户不可以来回点**」。
 * 那几秒是 `router.refresh()` 的往返（整页服务端重渲染，`/watch` 上尤其久）。
 * 在此之前这段时间里：按钮照样能按（虽然 `switchTo` 早就 `return` 掉了）、
 * 鼠标移上去还有 hover、**屏幕上一点动静都没有** —— 从用户那头看就是"点了没反应"，
 * 于是他去点第二下、第三下。**这不是性能问题，是没有把"正在忙"说出口。**
 *
 * 三件事一起做：① 两颗按钮 `disabled`（"点不动"要看得见，不能只在代码里默默 return）
 * ② 正在切的那一门**当场就显示成选中**（乐观），上面盖一颗转圈
 * ③ `aria-busy` + 一句读屏播报。
 *
 * ⚠️ **转圈是"盖"上去的，不是"挤"进去的**：标签留在原位、只是 `invisible`，
 * 转圈绝对定位压在它上面。原因是 M3.9 量过 —— 375px 的 `/watch` 页头只剩
 * **29.68px** 富余，这颗按钮一变宽，页头当场溢出。**改这里之前先记住这个数。**
 */

const OPTIONS = [
  { code: "zh-Hans", label: "中" },
  { code: "en", label: "EN" },
] as const;

/** 转圈。**不用 emoji/文字**，它要压在标签上，尺寸必须可控 */
function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 animate-spin" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LangToggle({ className = "" }: { className?: string }) {
  const t = useCopy();
  const router = useRouter();
  const current = useUiLang();
  const [pending, startTransition] = useTransition();
  // 正在切去哪一门。**只在 pending 期间有意义** —— 所以下面不需要在 effect 里清它
  // （清 state 的 effect 是 `react-hooks/set-state-in-effect` 要骂的东西，也确实多余）
  const [target, setTarget] = useState<string | null>(null);
  // D44：写库失败不许静默。**但只在"本该写得进去"的时候才算失败** —— 见 switchTo
  const [saveFailed, setSaveFailed] = useState(false);

  const busy = pending && target !== null;
  // 乐观：还没刷完就先把选中态挪过去。否则点下去到刷完这几秒里，
  // 高亮还赖在旧语言上，看着就像"没点中"
  const showing = busy ? target : current;

  function switchTo(code: string) {
    if (code === current || busy) return;
    setSaveFailed(false);
    setTarget(code);

    // ① 先写 cookie 再刷新。**顺序不能反** —— 服务端渲染读的就是这个 cookie，
    //    先刷新的话拿到的还是旧语言，界面会"点了没反应"。
    //    非 httpOnly 是 M3.9 片 b 就定好的（lib/ui-lang.ts 有说明）：里面只有一个
    //    语言码，不是凭据。
    writeUiLangCookie(code);

    // ② 立刻让服务端重渲染。整页 reload 会丢掉视频的播放位置（iframe 一重载就回到 0），
    //    `router.refresh()` 只作废服务端数据、不动已挂载的 iframe。
    //    **上面那个 `pending` 量的就是这一趟**：它一变回 false，新语言已经在屏幕上了。
    startTransition(() => router.refresh());

    // ③ 再把真身写进数据库（cookie 只是镜像，**换设备靠这一步**）。
    //    不 await —— 界面已经变了，这一步慢不该让人干等着。
    //
    //    ⚠️ 这里**不用 `putSettings()`**（那个只返回 true/false），因为
    //    「没登录」和「写库炸了」必须分开：前者是登录页/法务页的正常路径，
    //    后者是要说出口的故障（D44）。分得开的唯一办法是看状态码。
    //
    //    ⚠️ **这一趟故意不算进上面那个"忙"里**：它慢不该把按钮锁着。
    //    界面语言在 ② 结束时就已经是对的了，③ 只决定"换台设备还记不记得"。
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { uiLang: code } }),
    })
      .then((res) => {
        if (!res.ok && res.status !== 401) setSaveFailed(true);
      })
      .catch(() => {
        // 网络断了。cookie 已经写进去了，这台设备上语言是对的 ——
        // 但换台设备就不是，所以照样得说
        setSaveFailed(true);
      });
  }

  return (
    // `flex flex-col items-end` 是 2026-09-09 量出来才加的，**不是装饰**：
    // 那句 `saveFailed`（`max-w-[13rem]` = 208px）会把这个块撑到 208px 宽，
    // 而底下那圈药丸是 block 级 flex 容器 —— 它会**跟着长到 208px**，
    // 两颗按钮缩在左边、右边一大截空药丸。改成 items-end 之后药丸永远是内容宽
    // （76.63px），且贴着右边 —— 它待的每一处都是页头最右端。
    <div className={`flex flex-col items-end ${className}`}>
      <div
        role="group"
        aria-label={t("lang.toggle.aria")}
        aria-busy={busy}
        className="flex items-center gap-0.5 rounded-full border border-ink-500/60 p-0.5"
      >
        {OPTIONS.map((o) => {
          const active = showing === o.code;
          const spinning = busy && target === o.code;
          return (
            <button
              key={o.code}
              type="button"
              onClick={() => switchTo(o.code)}
              // 切换途中两颗都按不动。**`switchTo` 里那句 `return` 不够** ——
              // 它挡得住第二次点击，却挡不住"看上去还能点"（创始人就是这么来回点的）
              disabled={busy}
              aria-pressed={active}
              // 读屏里两个字母读不出意思，补一句完整的
              aria-label={o.code === "en" ? t("lang.toggle.toEn") : t("lang.toggle.toZh")}
              className={`relative min-h-8 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors ${
                active
                  ? "bg-teal-400 text-teal-950"
                  : "text-ink-300 enabled:hover:bg-ink-700 enabled:hover:text-ink-100"
              } ${busy ? "cursor-wait" : ""} ${busy && !active ? "opacity-45" : ""}`}
            >
              {/* 标签留在原位只是隐形 —— 宽度一个像素都不能变（见文件顶部那 29.68px） */}
              <span className={spinning ? "invisible" : ""}>{o.label}</span>
              {spinning && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* 读屏用户看不见转圈。**这一句是给他们的那颗转圈**（`role="status"` 会自动播报） */}
      <span role="status" aria-live="polite" className="sr-only">
        {busy ? t("lang.toggle.switching") : ""}
      </span>
      {saveFailed && (
        // D44：说得出是哪一种失败。**界面确实已经切了**（cookie 生效），
        // 没成的是"记进账号"这一半 —— 换台设备会变回去。别把两件事混成一句"失败了"。
        <p className="mt-1 max-w-[13rem] text-right text-[0.68rem] leading-4 text-ink-500">
          {t("lang.toggle.saveFailed")}
        </p>
      )}
    </div>
  );
}

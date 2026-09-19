"use client";

import { usePathname } from "next/navigation";
import { useCopy } from "@/components/copy-provider";
import { LangToggle } from "@/components/lang-toggle";
import { useIsWideAssumeWide } from "@/components/use-wide";

// D78 —— **手机暂时全关**（创始人 2026-09-19：「手机就全部关掉吧目前：如果检测到是手机
// 打开的就让他去电脑上 pc mac 去打开」，开工单 `plans/手机暂时关闭-2026-09-19.md`）。
//
// ── 这是一层**壳**，不是一次删除 ────────────────────────────────────────────
// 他写的是「**目前**」。所以：手机那套代码（`interrupt-panel` / `immersive-chat` /
// `capture-orb` / `dot-bar` 的窄屏分支、`watch-stage` 里所有 `isWide` 的另一半）
// **一行都没删**。**关掉这个功能 = 删掉 layout.tsx 里包住 `{children}` 的这一层**，
// 一分钟的事；删了那些代码再想打开是几天的事。
//
// ── 判据：只认窗口宽度，永远不做设备嗅探（D47①）──────────────────────────
// UA 不可靠（iPad 在 Safari 里谎报自己是 Mac）。代价是**把电脑窗口拖窄到 1024 以下
// 也会被拦** —— 所以文案里必须有「已经在电脑上？把窗口拉宽」那一句，否则那个人
// 会以为网站坏了。1024 和 `use-wide.ts` 的 `QUERY`、`watch-stage` 的 `LG_PX` 是同一个数。
//
// ── 首帧不许在电脑上闪（这一片最容易做砸的一条）──────────────────────────
// `useIsWide()` 的服务端 / 水合首帧**一律 false**，那是片 a 故意选的方向。照抄它的话，
// **电脑上会先渲染一帧拦截页**再换回应用 —— 整个应用闪一下。所以这里用的是
// `useIsWideAssumeWide()`（首帧当宽屏）：闪的那一帧落在手机上，反正手机下一帧就被拦。
//
// ── 被拦住时子树是**卸载**的，不是盖住的 ──────────────────────────────────
// D44 的脾气：别做「看着关了其实还在背后跑」的东西。他要的是「手机上没有一点功能」，
// 那就得是真的没有 —— 播放器不挂载、转写不轮询、记录器不跑。
// **代价说清楚**：在电脑上把窗口拖窄再拖回去，`/watch` 整棵重挂，YouTube iframe 会重载、
// 视频回到 0。这偏离了开工单 §4 第 3 条（那条写着「视频不重载」）；要两全就得把子树
// 留在原地盖住，那又恰恰是 D44 不许的那种「其实还在背后跑」。**记在交付日志里了。**
//
// ── 放行名单 ────────────────────────────────────────────────────────────────
// 这里是**唯一**一份，改这一行就是改放行策略。
//
// ① `/privacy` `/terms` —— 它们是**法律文书，不是功能**：应用商店的审核员、
//    想看看你怎么处理数据的人，都会在手机上点开。拦住它们没有任何好处。
// ② `/auth/callback` **不用写在这儿**，而且写了也没用 —— 它是 `route.ts`（路由处理器），
//    **根本不经过 layout**（Next 16 文档 01-app/01-getting-started/15-route-handlers.md：
//    "They do not participate in layouts"）。所以在手机上点邮件里的登录链接照样能换到
//    会话 cookie，换完它 `redirect` 到 `/`，那一下才被拦住 —— 拦得对：人已经登进去了，
//    接下来本来就该去电脑上。**别因为「开工单里提到它」就往名单里加一条死规则。**
// ③ `/login` 故意**不**放行：magic link 的会话落在**点链接的那台设备**上，在手机上登进去
//    对电脑那头一点帮助都没有，而他要的是「手机上没有一点功能」。
const ALWAYS_ALLOWED = ["/privacy", "/terms"] as const;

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function DesktopOnly({ children }: { children: React.ReactNode }) {
  const wide = useIsWideAssumeWide();
  const pathname = usePathname();

  if (wide || isAlwaysAllowed(pathname)) return <>{children}</>;
  return <DesktopNotice />;
}

/**
 * 「请到电脑上打开」那一整页。
 *
 * 长相照 `app/not-found.tsx` —— 那也是一张「整屏只说一件事」的页，
 * 同一套光晕 + 衬线标题，看着才像同一个产品，而不像一堵报错墙。
 *
 * **语言开关留着**（创始人 2026-09-09：「每一个界面都应该有」）：
 * 界面语言是猜出来的，猜错了的人得有办法把这一页读懂 —— 这一页正好是
 * 外国人最可能第一眼看到的那一张。它只写 cookie + `router.refresh()`，
 * 没有会话也能用（401 是法务页 / 登录页的正常路径，见 lang-toggle.tsx）。
 */
function DesktopNotice() {
  const t = useCopy();

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col items-center justify-center overflow-hidden px-5">
      <div className="ambient-grid pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60" />
      <div className="absolute right-5 top-[max(1rem,env(safe-area-inset-top))] z-10">
        <LangToggle />
      </div>
      <main className="page-enter relative w-full max-w-sm text-center">
        <div
          className="teal-halo mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full border border-teal-600/60"
          aria-hidden
        >
          <span className="text-3xl text-teal-300">𝄐</span>
        </div>
        <p className="eyebrow mb-3 text-teal-300">{t("desktopOnly.eyebrow")}</p>
        <h1 className="display-serif text-2xl text-ink-100">{t("desktopOnly.title")}</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-ink-300">
          {t("desktopOnly.lede")}
        </p>
        {/* 这一句是给「人在电脑上、只是窗口窄」的那位写的。**别删** ——
            没有它，按宽度拦就成了一个查不出原因的故障 */}
        <p className="mx-auto mt-5 max-w-xs text-xs leading-5 text-ink-500">
          {t("desktopOnly.widen")}
        </p>
      </main>
    </div>
  );
}

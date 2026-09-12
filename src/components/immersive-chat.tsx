"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// M3.15 片 b：这两个函数原来长在本文件里，现在搬去 `lib/chat-text.ts` ——
// 右栏那条问答线要用同一套，**不许复制粘贴两份**（计划「文件地图」）。
import { toSegments } from "@/lib/chat-text";
import { putSettings } from "@/lib/settings-client";
import { useCopy } from "@/components/copy-provider";

// M3 Phase-2 长问答沉浸聊天层（design/long-qa-immersive-chat.md）。
//
// 关键：**不碰视频 DOM** —— 磨砂面板从「视频底缘」往下铺到屏幕底，视频原地不动、
// 照常可播（播放器实例永不卸载、零跳动零重载，比移动视频更稳，WORKORDER D33）。
// 接后端：GET /api/chat（进入取逐字历史）、POST /api/chat（流式问答）、
// /api/chat/compact（退出浓缩 + 进入兜底）、/api/settings（流光配色）。
//
// 文字流是 Apple Music 歌词式：无气泡/头像/名称/边框，同一左侧网格，按时间顺序，
// 最新最亮、旧的以透明度融进磨砂背景。语音输入管线（M0.5 Live）另一档，本片先给打字。

interface Turn {
  role: "user" | "assistant";
  text: string;
  at_s?: number;
}

/** 流光配色预设（每套 4 色，薄荷/青/紫/粉族）。默认与 CSS :root 一致 */
const GLOW_PRESETS: {
  id: string;
  /** 配色的名字走文案表（`chat.glow*`）—— 色值不翻，名字要翻 */
  nameKey: "chat.glowAurora" | "chat.glowBamboo" | "chat.glowDusk" | "chat.glowNebula" | "chat.glowInk";
  colors: [string, string, string, string];
}[] = [
  { id: "aurora", nameKey: "chat.glowAurora", colors: ["#5dcaa5", "#3bc4d6", "#8b7cf0", "#f0a6c8"] },
  { id: "bamboo", nameKey: "chat.glowBamboo", colors: ["#9fe1cb", "#5dcaa5", "#1d9e75", "#0f6e56"] },
  { id: "dusk", nameKey: "chat.glowDusk", colors: ["#f0a6c8", "#f7b28c", "#f0d98c", "#c88cf0"] },
  { id: "nebula", nameKey: "chat.glowNebula", colors: ["#8b7cf0", "#6d8bf0", "#3bc4d6", "#b58cf0"] },
  { id: "ink", nameKey: "chat.glowInk", colors: ["#b4b2a9", "#9fe1cb", "#f1efe8", "#888780"] },
];
const DEFAULT_GLOW = GLOW_PRESETS[0].colors;

/**
 * 字号档位（2026-08-01 创始人要的）。一个数带动整条文字流 ——
 * AI 用它，提问用它的 0.84 倍，两者的比例是设计定死的，不给两个滑块让人自己去配。
 */
const CHAT_FONTS = [
  { px: 20, nameKey: "chat.fsS" },
  { px: 24, nameKey: "chat.fsM" },
  { px: 28, nameKey: "chat.fsL" },
  { px: 32, nameKey: "chat.fsXL" },
] as const;
const DEFAULT_CHAT_FONT = 24;

interface ImmersiveChatProps {
  sourceId: string;
  /**
   * 台面底缘（视口坐标 px）—— 磨砂面板从这条线往下铺。由 WatchStage 量好传进来。
   *
   * 2026-08-05 创始人真机反馈改的：**原来锚的是视频底缘，那会把状态卡整个盖住**。
   * 而磨砂顶上那 34px 是透明过渡带（design §4），状态卡就从带子里透出来、
   * 和歌词流第一行叠在一起。现在锚在状态卡下边缘：时间进度 + 倍速 + ±N 秒全露着。
   * **±N 秒在沉浸态里是真有用的** —— `atS` 在按发送那一刻才取播放头（见下面的 send），
   * 跳完再问，AI 换的就是那一段字幕。
   */
  stageBottom: number;
  /** 当前播放头（秒），发问时作为 atS */
  getCurrentTime: () => number;
  /** 暂停视频 —— 发问前调用（创始人：问答一定要视频处于暂停态） */
  pauseVideo: () => void;
  /** 退出沉浸态（键盘 Esc 可达；主退出走悬浮球长按） */
  onExit: () => void;
}

export function ImmersiveChat({
  sourceId,
  stageBottom,
  getCurrentTime,
  pauseVideo,
  onExit,
}: ImmersiveChatProps) {
  const t = useCopy();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [glow, setGlow] = useState<[string, string, string, string]>(DEFAULT_GLOW);
  const [atBottom, setAtBottom] = useState(true);
  const [showPalette, setShowPalette] = useState(false);
  const [fontPx, setFontPx] = useState(DEFAULT_CHAT_FONT);
  const [showFont, setShowFont] = useState(false);
  const [burst, setBurst] = useState(true); // 进入时的扩散光，放完卸载

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 打字机流式（创始人：思考中最多闪一下，然后像 GPT 一字一字快速吐出）──
  // 网络分块大小不定（Gemini 常一次给一整句），直接上屏就是"一下子一堆"。
  // 所以：收到的整段进 fullTextRef，一个定时器按固定节奏把 shown 往前推，视觉上恒定逐字。
  const revealTimerRef = useRef<number | null>(null);
  const fullTextRef = useRef("");
  const shownRef = useRef(0);
  const streamDoneRef = useRef(false);

  // 卸载时清掉打字机定时器
  useEffect(
    () => () => {
      if (revealTimerRef.current != null) window.clearInterval(revealTimerRef.current);
    },
    [],
  );

  // 台面底缘由 WatchStage 量好传进来（暂停面板也吃同一个值，所以只量一次）

  // 扩散光放完就卸载（省一层永久合成）
  useEffect(() => {
    const id = window.setTimeout(() => setBurst(false), 1000);
    return () => window.clearTimeout(id);
  }, []);

  // 配色同步到 :root —— 边缘流光、磨砂、以及 CaptureOrb 里的 Siri 球都读这套变量，
  // 一处改处处变（球不在本组件作用域内，只靠局部变量它不会跟着换）。退出后保留用户选色。
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--glow-1", glow[0]);
    root.style.setProperty("--glow-2", glow[1]);
    root.style.setProperty("--glow-3", glow[2]);
    root.style.setProperty("--glow-4", glow[3]);
  }, [glow]);

  // 锁背景滚动 + Esc 退出（键盘可达，便于桌面验证）
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onExit]);

  // ── compact 存档（M3.5 修的那个 bug） ──
  //
  // 老写法只在**组件卸载**时发一次。生产库实证它漏了：有一行 messages 8 条、
  // summarized_upto 只有 2 —— 直接关标签页 / 切走 App / 系统回收内存时，React 的卸载回调
  // 根本不会跑，那几轮就一直没折进 summary。后果不是"用户看不到聊天记录"（逐字原文一直是好的），
  // 而是 AI 的上下文里 liveTurns 无限长下去：每问一句都把历史逐字全塞回去，token 和钱一起涨。
  //
  // 三层保险（创始人 2026-07-25 定：都要）：
  //   ① visibilitychange(hidden) 与 pagehide 也发一次 —— 手机上这两个才是可靠的"要走了"信号；
  //   ② 服务端 compact 本来就幂等（没新逐轮直接返回旧 summary、不烧调用），多发几次没副作用；
  //   ③ 进入时无条件补发一次，兜住"上次强退"。
  // dirtyRef 只是省无谓的往返：这次会话没新增逐轮就不发（服务端那边也会幂等挡掉）。
  const dirtyRef = useRef(false);
  const compact = useCallback(
    (force = false) => {
      if (!force && !dirtyRef.current) return;
      dirtyRef.current = false;
      void fetch(`/api/chat/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId }),
        keepalive: true, // 页面正在被关掉时也要发得出去
      }).catch(() => {
        dirtyRef.current = true; // 没发成，留着下一个时机再发
      });
    },
    [sourceId],
  );

  // 切后台 / 关页面 / 卸载 —— 三个出口都补一刀
  useEffect(() => {
    const onHide = () => compact();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") compact();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      compact(); // 正常退出（长按悬浮球 / Esc / 离开观看页）
    };
  }, [compact]);

  // M3.6：原来这里把逐字条数报给观看页，是给那份暂停点回看列表的「聊过 N 轮」用的。
  // 那份列表已经搬去 `/library/[id]`（D37/D38），观看页上没有任何东西读这个数了，
  // 回看页的轮数由服务端首屏直接查 chats.messages 得出 —— 这条回调随之作废。

  // ── 进入：取逐字历史 + 配色；顺手无条件兜底 compact（防上次强退没跑成）──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch(`/api/chat?sourceId=${encodeURIComponent(sourceId)}`),
          fetch(`/api/settings`),
        ]);
        if (cRes.ok) {
          const b = await cRes.json();
          if (alive && Array.isArray(b.messages)) setTurns(b.messages as Turn[]);
        }
        if (sRes.ok) {
          const b = await sRes.json();
          const g = b?.settings?.chatGlow;
          if (alive && Array.isArray(g) && g.length === 4) {
            setGlow(g as [string, string, string, string]);
          }
          // 字号只认档位表里的数 —— 库里存着个 9px 不该被端上来
          const f = Number(b?.settings?.chatFont);
          if (alive && CHAT_FONTS.some((o) => o.px === f)) setFontPx(f);
        }
      } catch {
        // 取不到历史不致命：空着接着聊
      }
      if (alive) setLoaded(true);
    })();

    // 进入兜底 compact：**无条件**发一次。它跟上面取历史是并行的，不排在"成功进入"之后 ——
    // 上次强退欠下的账，进来这一发就补上了（服务端幂等，没新逐轮不烧调用）。
    compact(true);

    return () => {
      alive = false;
    };
  }, [sourceId, compact]);

  // 停在底部就自动跟最新；用户上滑看历史则不抢滚动（design §D）
  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, atBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 56);
  };

  const backToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  const pickGlow = (colors: [string, string, string, string]) => {
    setGlow(colors);
    setShowPalette(false);
    void fetch(`/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { chatGlow: colors } }),
    }).catch(() => {});
  };

  const pickFont = (px: number) => {
    setFontPx(px);
    setShowFont(false);
    void putSettings({ chatFont: px });
  };

  // 把最后一条 AI 的正文设为 text（打字机每帧调用）
  const setLastAssistantText = (text: string) =>
    setTurns((prev) => {
      const n = [...prev];
      const last = n[n.length - 1];
      if (last && last.role === "assistant") n[n.length - 1] = { ...last, text };
      return n;
    });

  const stopReveal = () => {
    if (revealTimerRef.current != null) {
      window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };

  const dropEmptyTail = () =>
    setTurns((prev) => {
      const n = [...prev];
      const last = n[n.length - 1];
      if (last && last.role === "assistant" && !last.text) n.pop();
      return n;
    });

  // ── 发问：乐观追加用户 + 空 AI 两轮 → POST /api/chat 流式填进 fullTextRef → 打字机逐字上屏 ──
  const send = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question || sending) return;
      pauseVideo(); // 创始人：问答一定要视频处于暂停态
      setInput("");
      setError("");
      const atS = Math.max(0, Math.round(getCurrentTime()));
      setTurns((prev) => [
        ...prev,
        { role: "user", text: question, at_s: atS },
        { role: "assistant", text: "", at_s: atS },
      ]);
      setAtBottom(true);
      setSending(true);

      // 打字机：fullTextRef 是收到的全部，shownRef 是已上屏的字数，定时器把它往前推。
      // 恒定节奏、按积压量自适应步长（一次给一整句也能很快追上，但仍是逐字动效）。
      fullTextRef.current = "";
      shownRef.current = 0;
      streamDoneRef.current = false;
      stopReveal();
      revealTimerRef.current = window.setInterval(() => {
        const full = fullTextRef.current;
        if (shownRef.current < full.length) {
          const remaining = full.length - shownRef.current;
          const step = Math.max(2, Math.ceil(remaining / 45)); // 积压越多推得越快，最少 2 字
          shownRef.current = Math.min(full.length, shownRef.current + step);
          setLastAssistantText(full.slice(0, shownRef.current));
        } else if (streamDoneRef.current) {
          stopReveal();
          setSending(false);
        }
      }, 16);

      try {
        const res = await fetch(`/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId, question, atS }),
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? t("chat.answerFailed"));
        }

        // NDJSON：chunk 累进 fullTextRef（不直接上屏，交给打字机）、done 校正、error 报错
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let streamErr = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
            const raw = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!raw) continue;
            let ev: { type?: string; text?: string; answer?: string; message?: string };
            try {
              ev = JSON.parse(raw);
            } catch {
              continue;
            }
            if (ev.type === "chunk" && ev.text) {
              fullTextRef.current += ev.text;
            } else if (ev.type === "done") {
              if (typeof ev.answer === "string") fullTextRef.current = ev.answer;
            } else if (ev.type === "error") {
              streamErr = ev.message ?? t("chat.answerFailed");
            }
          }
        }
        if (streamErr) {
          stopReveal();
          setSending(false);
          setError(streamErr);
          dropEmptyTail();
        } else {
          // 答成了 = 库里多了一问一答两条逐字，等着被折进 summary
          dirtyRef.current = true;
          // 让打字机把剩下的字吐完，吐完它自己收尾（清定时器 + setSending(false)）
          streamDoneRef.current = true;
        }
      } catch (e) {
        stopReveal();
        setSending(false);
        setError(e instanceof Error ? e.message : t("chat.answerFailed"));
        dropEmptyTail();
      }
    },
    [sending, sourceId, getCurrentTime, pauseVideo, t],
  );

  const n = turns.length;
  const glowVars = {
    "--glow-1": glow[0],
    "--glow-2": glow[1],
    "--glow-3": glow[2],
    "--glow-4": glow[3],
  } as React.CSSProperties;

  return (
    <>
      {/* 整页外缘流光边 + 进入扩散光。z 抬到最高 + pointer-events-none：四角/顶部标题都被
          流光框住（含视频与页头），且绝不挡视频控件与聊天（创始人反馈 1：铺满全屏、加粗） */}
      <div className="pointer-events-none fixed inset-0 z-[60]" style={glowVars} aria-hidden>
        <div className="edge-glow absolute inset-0" />
        {burst && (
          <div
            className="glow-burst absolute left-1/2 h-32 w-32 -translate-x-1/2 rounded-full"
            style={{ bottom: 60 }}
          />
        )}
      </div>

      {/* 磨砂聊天层：从**状态卡下边缘**往下铺到屏幕底。
          视频和它下面那排控件（时间 / 倍速 / ±N 秒）都露在外面、照常能点 */}
      <div
        className="chat-frost fixed inset-x-0 bottom-0 z-40 flex flex-col"
        style={{ ...glowVars, top: stageBottom }}
        role="dialog"
        aria-label={t("chat.aria")}
      >
        {/* 右上角两颗克制的入口：字号 + 配色。同一时刻只摊开一个 */}
        <div className="absolute right-3 top-2 z-10 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowFont((v) => !v);
                setShowPalette(false);
              }}
              aria-label={t("chat.fontLabel")}
              aria-expanded={showFont}
              className="glass flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold leading-none text-ink-100"
            >
              <span aria-hidden>A</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPalette((v) => !v);
                setShowFont(false);
              }}
              aria-label={t("chat.paletteLabel")}
              aria-expanded={showPalette}
              className="h-7 w-7 rounded-full border border-ink-100/20"
              style={{
                background: `conic-gradient(from 210deg, ${glow[0]}, ${glow[1]}, ${glow[2]}, ${glow[3]}, ${glow[0]})`,
              }}
            />
          </div>
          {showFont && (
            <div className="glass flex items-center gap-1.5 rounded-2xl px-2.5 py-2">
              <span className="mr-0.5 text-[0.68rem] text-ink-100/50">{t("chat.fontHint")}</span>
              {CHAT_FONTS.map((o) => (
                <button
                  key={o.px}
                  type="button"
                  onClick={() => pickFont(o.px)}
                  aria-label={`${t("chat.fontHint")}：${t(o.nameKey)}`}
                  className={`min-h-8 rounded-full px-2.5 text-xs font-semibold transition-colors ${
                    o.px === fontPx
                      ? "bg-teal-400 text-teal-950"
                      : "border border-ink-100/20 text-ink-100/80"
                  }`}
                >
                  {t(o.nameKey)}
                </button>
              ))}
            </div>
          )}
          {showPalette && (
            <div className="glass flex gap-2 rounded-2xl px-2.5 py-2">
              {GLOW_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickGlow(p.colors)}
                  aria-label={t("chat.paletteAria", t(p.nameKey))}
                  title={t(p.nameKey)}
                  className="h-6 w-6 rounded-full border border-ink-100/20"
                  style={{
                    background: `conic-gradient(from 210deg, ${p.colors[0]}, ${p.colors[1]}, ${p.colors[2]}, ${p.colors[3]}, ${p.colors[0]})`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 歌词式文字流：无气泡/头像/名称/边框（design §1）。
            **提问靠右、回答靠左** —— 2026-08-01 创始人真机反馈：全都贴着左边，
            读起来分不清哪句是自己问的。左右分家是最省笔墨的区分，比加气泡、加名字都轻。
            字号由 --chat-fs 一个变量带动，AI 用整数、提问用它的 0.84 倍。 */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="lyric-flow min-h-0 flex-1 overflow-y-auto px-5 pt-9"
          style={{ paddingBottom: 232, "--chat-fs": `${fontPx}px` } as React.CSSProperties}
        >
          <div className="mx-auto w-full max-w-[88%]">
            {loaded && n === 0 && (
              <p
                className="pt-6 leading-snug text-ink-100/45"
                style={{ fontSize: "calc(var(--chat-fs) * 0.92)" }}
              >
                {t("chat.empty")}
              </p>
            )}
            {/* 形参叫 `turn` 不叫 `t` —— `t` 是翻译函数，同名会把它遮住 */}
            {turns.map((turn, i) => {
              const fromEnd = n - 1 - i;
              const isLast = fromEnd === 0;
              const isUser = turn.role === "user";
              // 最新最亮；越旧越融进背景。用户略低于 AI（design §1）
              const opacity = isUser
                ? isLast
                  ? 0.82
                  : Math.max(0.3, 0.64 - fromEnd * 0.11)
                : isLast
                  ? 1
                  : Math.max(0.34, 0.72 - fromEnd * 0.11);
              const streaming = isLast && !isUser && sending;
              const segs = toSegments(turn.text);
              // 用户 = 靠右 + 窄一档 + 上方大间距；AI = 靠左满宽最亮，紧贴它回答的那句问题。
              // 首条不留上边距。
              const blockCls = isUser
                ? `${i === 0 ? "" : "mt-9"} ml-[22%] text-right`
                : `${i === 0 ? "" : "mt-3"}`;
              const lineStyle = {
                fontSize: isUser ? "calc(var(--chat-fs) * 0.84)" : "var(--chat-fs)",
              };
              return (
                <div key={i} className={blockCls} style={{ opacity }}>
                  {segs.length === 0 && streaming ? (
                    <p className="leading-[1.32] text-ink-100" style={lineStyle}>
                      <span className="animate-pulse text-teal-300">{t("chat.thinking")}</span>
                    </p>
                  ) : (
                    segs.map((s, j) => (
                      <p key={j} className="leading-[1.32] text-ink-100" style={lineStyle}>
                        {s}
                        {streaming && j === segs.length - 1 && (
                          <span className="ml-0.5 animate-pulse text-teal-300">▍</span>
                        )}
                      </p>
                    ))
                  )}
                </div>
              );
            })}
            {error && (
              <p role="alert" className="mt-5 text-[18px] leading-relaxed text-teal-300/90">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* 「回到最新」：用户上滑看历史时才出现，点了才回底（design §D） */}
        {!atBottom && (
          <button
            type="button"
            onClick={backToLatest}
            className="glass absolute left-1/2 bottom-[224px] -translate-x-1/2 rounded-full px-4 py-1.5 text-xs font-semibold text-ink-100"
          >
            {t("chat.toLatest")}
          </button>
        )}

        {/* 输入条（本片先给打字；语音管线 M0.5 Live 另接）。排在底部正中圆球的上方 */}
        <div className="absolute inset-x-0 px-4" style={{ bottom: 156 }}>
          <div className="glass flex items-end gap-2 rounded-3xl px-3 py-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={t("chat.placeholder")}
              className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-ink-100 placeholder:text-ink-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={sending || !input.trim()}
              onClick={() => void send(input)}
              className="min-h-11 shrink-0 rounded-2xl bg-teal-400/90 px-4 text-sm font-semibold text-ink-900 transition-colors hover:bg-teal-300 disabled:opacity-40"
            >
              {sending ? "…" : t("chat.send")}
            </button>
          </div>
        </div>

        {/* 退出提示（圆球上方，克制）。主退出 = 长按底部正中圆球（design §E） */}
        <p
          className="pointer-events-none absolute inset-x-0 text-center text-xs text-ink-100/45"
          style={{ bottom: 134 }}
        >
          {t("chat.exitHint")}
        </p>
      </div>
    </>
  );
}

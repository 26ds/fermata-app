"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
const GLOW_PRESETS: { id: string; name: string; colors: [string, string, string, string] }[] = [
  { id: "aurora", name: "极光", colors: ["#5dcaa5", "#3bc4d6", "#8b7cf0", "#f0a6c8"] },
  { id: "bamboo", name: "青竹", colors: ["#9fe1cb", "#5dcaa5", "#1d9e75", "#0f6e56"] },
  { id: "dusk", name: "暮霞", colors: ["#f0a6c8", "#f7b28c", "#f0d98c", "#c88cf0"] },
  { id: "nebula", name: "星云", colors: ["#8b7cf0", "#6d8bf0", "#3bc4d6", "#b58cf0"] },
  { id: "ink", name: "素墨", colors: ["#b4b2a9", "#9fe1cb", "#f1efe8", "#888780"] },
];
const DEFAULT_GLOW = GLOW_PRESETS[0].colors;

/** 把一轮文字切成 1–4 行的小段（按换行 + 句末标点），歌词式留白 */
function toSegments(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?…])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

interface ImmersiveChatProps {
  sourceId: string;
  /** 视频外壳 div 的 ref —— 用来量「视频底缘」，磨砂面板从这条线往下铺 */
  videoRef: React.RefObject<HTMLDivElement | null>;
  /** 当前播放头（秒），发问时作为 atS */
  getCurrentTime: () => number;
  /** 退出沉浸态（键盘 Esc 可达；主退出走悬浮球长按） */
  onExit: () => void;
}

export function ImmersiveChat({ sourceId, videoRef, getCurrentTime, onExit }: ImmersiveChatProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [glow, setGlow] = useState<[string, string, string, string]>(DEFAULT_GLOW);
  const [top, setTop] = useState(0); // 磨砂面板顶 = 视频底缘 px
  const [atBottom, setAtBottom] = useState(true);
  const [showPalette, setShowPalette] = useState(false);
  const [burst, setBurst] = useState(true); // 进入时的扩散光，放完卸载

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 量「视频底缘」：磨砂面板从这条线往下铺（design §4 过渡带） ──
  useLayoutEffect(() => {
    const measure = () => {
      const el = videoRef.current;
      if (el) setTop(Math.max(0, Math.round(el.getBoundingClientRect().bottom)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (videoRef.current) ro.observe(videoRef.current);
    window.addEventListener("resize", measure);
    // 播放器加载 / 地址栏收放会引起回流，兜底轮询一小会儿
    const t = window.setInterval(measure, 400);
    const stop = window.setTimeout(() => window.clearInterval(t), 4000);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, [videoRef]);

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

  // ── 进入：取逐字历史 + 配色；顺手兜底 compact（防上次强退没跑成）。
  //    退出（卸载）：对本次会话跑 compact，折进 summary。keepalive 保命，跑不成下次进入再兜底。 ──
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
        }
      } catch {
        // 取不到历史不致命：空着接着聊
      }
      if (alive) setLoaded(true);
    })();

    // 进入兜底 compact（幂等：没有未浓缩的新逐轮就不烧调用）
    void fetch(`/api/chat/compact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId }),
    }).catch(() => {});

    return () => {
      alive = false;
      // 退出 compact：把这次会话浓缩进 summary（给 AI 当往期背景，不喂逐字）
      void fetch(`/api/chat/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [sourceId]);

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

  // ── 发问：乐观追加用户 + 空 AI 两轮 → POST /api/chat 流式填 AI（服务端 append 落库） ──
  const send = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question || sending) return;
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

      const dropEmptyTail = () =>
        setTurns((prev) => {
          const n = [...prev];
          const last = n[n.length - 1];
          if (last && last.role === "assistant" && !last.text) n.pop();
          return n;
        });

      try {
        const res = await fetch(`/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId, question, atS }),
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? "没答出来，稍后再试");
        }

        // NDJSON：chunk 逐块拼进最后一条 AI、done 收尾、error 报错
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
              const piece = ev.text;
              setTurns((prev) => {
                const n = [...prev];
                const last = n[n.length - 1];
                if (last && last.role === "assistant") {
                  n[n.length - 1] = { ...last, text: last.text + piece };
                }
                return n;
              });
            } else if (ev.type === "done") {
              const full = ev.answer;
              if (typeof full === "string") {
                setTurns((prev) => {
                  const n = [...prev];
                  const last = n[n.length - 1];
                  if (last && last.role === "assistant") n[n.length - 1] = { ...last, text: full };
                  return n;
                });
              }
            } else if (ev.type === "error") {
              streamErr = ev.message ?? "没答出来，稍后再试";
            }
          }
        }
        if (streamErr) {
          setError(streamErr);
          dropEmptyTail();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "没答出来，稍后再试");
        dropEmptyTail();
      } finally {
        setSending(false);
      }
    },
    [sending, sourceId, getCurrentTime],
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
      {/* 整页外缘流光边 + 进入扩散光。pointer-events-none：绝不挡视频控件与聊天 */}
      <div className="pointer-events-none fixed inset-0 z-[45]" style={glowVars} aria-hidden>
        <div className="edge-glow absolute inset-0" />
        {burst && (
          <div
            className="glow-burst absolute left-1/2 h-32 w-32 -translate-x-1/2 rounded-full"
            style={{ bottom: 60 }}
          />
        )}
      </div>

      {/* 磨砂聊天层：从视频底缘往下铺到屏幕底（不覆盖视频，视频照常可播） */}
      <div
        className="chat-frost fixed inset-x-0 bottom-0 z-40 flex flex-col"
        style={{ ...glowVars, top }}
        role="dialog"
        aria-label="长问答沉浸聊天"
      >
        {/* 配色（右上角克制入口）：满足「颜色后台设置用户可自定义」，落 /api/settings */}
        <div className="absolute right-3 top-2 z-10 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setShowPalette((v) => !v)}
            aria-label="更换流光配色"
            className="h-7 w-7 rounded-full border border-ink-100/20"
            style={{
              background: `conic-gradient(from 210deg, ${glow[0]}, ${glow[1]}, ${glow[2]}, ${glow[3]}, ${glow[0]})`,
            }}
          />
          {showPalette && (
            <div className="glass flex gap-2 rounded-2xl px-2.5 py-2">
              {GLOW_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickGlow(p.colors)}
                  aria-label={`配色：${p.name}`}
                  title={p.name}
                  className="h-6 w-6 rounded-full border border-ink-100/20"
                  style={{
                    background: `conic-gradient(from 210deg, ${p.colors[0]}, ${p.colors[1]}, ${p.colors[2]}, ${p.colors[3]}, ${p.colors[0]})`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 歌词式文字流：同一左侧网格，无气泡/头像/名称/边框（design §1） */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="lyric-flow min-h-0 flex-1 overflow-y-auto px-5 pt-9"
          style={{ paddingBottom: 232 }}
        >
          <div className="mx-auto w-full max-w-[88%]">
            {loaded && n === 0 && (
              <p className="pt-6 text-[22px] leading-snug text-ink-100/45">
                有什么想问的？扣着当前进度，接着聊。
              </p>
            )}
            {turns.map((t, i) => {
              const fromEnd = n - 1 - i;
              const isLast = fromEnd === 0;
              // 最新最亮；越旧越融进背景。用户略低于 AI（design §1）
              const opacity =
                t.role === "assistant"
                  ? isLast
                    ? 1
                    : Math.max(0.34, 0.72 - fromEnd * 0.11)
                  : isLast
                    ? 0.82
                    : Math.max(0.3, 0.64 - fromEnd * 0.11);
              const streaming = isLast && t.role === "assistant" && sending;
              const segs = toSegments(t.text);
              return (
                <div key={i} className="mt-[22px] first:mt-0" style={{ opacity }}>
                  {segs.length === 0 && streaming ? (
                    <p className="text-[24px] leading-[1.32] text-ink-100">
                      <span className="animate-pulse text-teal-300">正在想…</span>
                    </p>
                  ) : (
                    segs.map((s, j) => (
                      <p key={j} className="text-[24px] leading-[1.32] text-ink-100">
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
            回到最新 ↓
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
              placeholder="接着问一句…"
              className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-ink-100 placeholder:text-ink-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={sending || !input.trim()}
              onClick={() => void send(input)}
              className="min-h-11 shrink-0 rounded-2xl bg-teal-400/90 px-4 text-sm font-semibold text-ink-900 transition-colors hover:bg-teal-300 disabled:opacity-40"
            >
              {sending ? "…" : "发送"}
            </button>
          </div>
        </div>

        {/* 退出提示（圆球上方，克制）。主退出 = 长按底部正中圆球（design §E） */}
        <p
          className="pointer-events-none absolute inset-x-0 text-center text-xs text-ink-100/45"
          style={{ bottom: 134 }}
        >
          长按悬浮球退出
        </p>
      </div>
    </>
  );
}

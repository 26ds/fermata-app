"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adapterFor } from "@/lib/sources/registry";
import type { PlayerHandle } from "@/lib/sources/types";
import type { SourceRow } from "@/lib/types";

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 进度回写节流：播放中最快 10 秒存一次，别把网络当秒表用 */
const SAVE_EVERY_MS = 10_000;

/**
 * M1 的中枢：拿到 PlayerHandle，持续知道"现在播到第几秒"。
 * 1b 的悬浮球、1c 的点点条都会挂在这里。
 */
export function WatchStage({ source }: { source: SourceRow }) {
  const adapter = adapterFor(source.kind);

  const handleRef = useRef<PlayerHandle | null>(null);
  const currentTimeRef = useRef(0);
  const durationSentRef = useRef(source.duration_s != null);
  const lastSavedAtRef = useRef(0);
  const lastSavedValueRef = useRef(source.last_position_s ?? 0);
  const clockRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);

  const handleReady = useCallback((handle: PlayerHandle) => {
    handleRef.current = handle;
  }, []);

  /** 回写"看到第几秒"。keepalive：页面正在被关掉时请求也能发出去 */
  const savePosition = useCallback(
    (keepalive = false) => {
      const t = currentTimeRef.current;
      if (t < 1) return;
      if (Math.abs(t - lastSavedValueRef.current) < 1) return;
      lastSavedValueRef.current = t;
      lastSavedAtRef.current = Date.now();
      void fetch(`/api/sources/${source.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastPositionS: t }),
        keepalive,
      }).catch(() => {
        // 存不上不影响观看，下一轮再试
      });
    },
    [source.id],
  );

  const handlePlayingChange = useCallback(
    (next: boolean) => {
      setPlaying(next);
      // 暂停的那一刻是最该记住的位置
      if (!next) savePosition();
    },
    [savePosition],
  );

  useEffect(() => {
    // 每 250ms 读一次位置。刻意写进 ref + 直改 DOM，不走 setState ——
    // 每秒 4 次 setState 会把整页重渲染，M0.5 已经在这上面栽过一次。
    const timer = window.setInterval(() => {
      const handle = handleRef.current;
      if (!handle) return;

      const t = handle.getCurrentTime();
      currentTimeRef.current = t;
      if (clockRef.current) clockRef.current.textContent = mmss(t);

      const duration = handle.getDuration();
      if (duration > 0 && totalRef.current) totalRef.current.textContent = mmss(duration);

      // 时长只回写一次：oEmbed 拿不到，只有播放器就绪后才知道真实秒数
      if (!durationSentRef.current && duration > 0) {
        durationSentRef.current = true;
        void fetch(`/api/sources/${source.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ durationS: duration }),
        }).catch(() => {
          durationSentRef.current = false;
        });
      }

      if (Date.now() - lastSavedAtRef.current > SAVE_EVERY_MS) savePosition();
    }, 250);
    return () => window.clearInterval(timer);
  }, [source.id, savePosition]);

  useEffect(() => {
    // 手机上"离开页面"多半不触发 unload，pagehide + 切后台才是可靠信号
    const onLeave = () => savePosition(true);
    const onHidden = () => {
      if (document.visibilityState === "hidden") savePosition(true);
    };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onHidden);
      savePosition(true);
    };
  }, [savePosition]);

  if (!adapter) {
    return (
      <div className="rounded-2xl border border-ink-700 p-5 text-sm text-ink-300">
        这类内容（{source.kind}）的播放器还没做。
      </div>
    );
  }

  const { Player } = adapter;

  return (
    <div className="flex flex-col gap-4">
      <Player source={source} onReady={handleReady} onPlayingChange={handlePlayingChange} />

      <div className="flex items-center justify-between rounded-2xl border border-ink-700 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${playing ? "bg-teal-400" : "bg-ink-500"}`}
            aria-hidden
          />
          <span className="text-sm text-ink-300">{playing ? "播放中" : "已暂停"}</span>
        </div>
        <p className="ui-mono text-sm text-ink-100" aria-label="播放位置">
          <span ref={clockRef}>{source.last_position_s ? mmss(source.last_position_s) : "00:00"}</span>
          <span className="text-ink-500"> / </span>
          <span ref={totalRef} className="text-ink-500">
            {source.duration_s ? mmss(source.duration_s) : "--:--"}
          </span>
        </p>
      </div>
    </div>
  );
}

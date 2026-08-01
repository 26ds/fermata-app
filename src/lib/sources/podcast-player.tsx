"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mmss } from "@/lib/time";
import type { PlayerProps } from "./types";

// M1d — 播客播放器。一个原生 <audio> 包一层 PlayerHandle，上层完全无感。
//
// 为什么自己画控件而不是用 <audio controls>：原生控件在 iOS 上是一条白色胶囊，
// 跟整个深色界面打架，且高度不受控 —— 而 D18 刚把纵向空间抠出来给内容。
// 这里只做三件事：播/停、拖动进度、看时间。
//
// ±秒 与 倍速**不在这里**：它们是观看页那条共用控制条的活（components/player-controls.tsx，
// 视频和播客同一套、步长可调）。原来这里另有一对 ±15 —— 手机上两套跳跃键上下并排、
// 数字还不一样，是明摆着的灾难，所以这一版把它撤了。

/** 只剩系统键在用的步长（锁屏 / 控制中心的快退快进）。15 秒是播客客户端的通用口径 */
const SKIP_S = 15;

export function PodcastPlayer({ source, onReady, onPlayingChange, onPause }: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  /** 用户正拖着进度条时，别让 timeupdate 把滑块拽回去 */
  const draggingRef = useRef(false);
  const readySentRef = useRef(false);

  // 回调走 ref：父组件每次重渲染都给新函数引用，直接进依赖会让 effect 反复重挂
  const onReadyRef = useRef(onReady);
  const onPlayingChangeRef = useRef(onPlayingChange);
  const onPauseRef = useRef(onPause);
  useEffect(() => {
    onReadyRef.current = onReady;
    onPlayingChangeRef.current = onPlayingChange;
    onPauseRef.current = onPause;
  });

  // 这两个各自只变一次（元数据到手时），走 state 不心疼
  const [durationS, setDurationS] = useState(source.duration_s ?? 0);
  const [playing, setPlaying] = useState(false);

  const audioUrl = source.url ?? "";

  const seekBy = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : Number.MAX_SAFE_INTEGER;
    audio.currentTime = Math.min(max, Math.max(0, audio.currentTime + delta));
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const publish = () => {
      if (readySentRef.current) return;
      readySentRef.current = true;
      onReadyRef.current({
        getCurrentTime: () => audio.currentTime || 0,
        // 直播流的 duration 是 Infinity —— 契约要求未知时返回 0，别把 Infinity 漏出去
        getDuration: () => (Number.isFinite(audio.duration) ? audio.duration : 0),
        seekTo: (seconds) => {
          audio.currentTime = Math.max(0, seconds);
        },
        play: () => void audio.play().catch(() => {}),
        pause: () => audio.pause(),
        setRate: (rate) => {
          audio.playbackRate = rate;
        },
        getRate: () => audio.playbackRate || 1,
      });
    };

    const onMeta = () => {
      publish();
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationS(audio.duration);
        if (seekRef.current) seekRef.current.max = String(audio.duration);
      }
    };

    const onTime = () => {
      if (clockRef.current) clockRef.current.textContent = mmss(audio.currentTime);
      // 直改 DOM，不 setState —— timeupdate 一秒来 4 次，整页重渲染 4 次是 M0.5 踩过的坑
      if (!draggingRef.current && seekRef.current) {
        seekRef.current.value = String(audio.currentTime);
      }
    };

    const onPlay = () => {
      setPlaying(true);
      onPlayingChangeRef.current(true);
    };

    const onPauseEvent = () => {
      setPlaying(false);
      onPlayingChangeRef.current(false);
      // D17：只有"用户真的按了暂停"才算求助信号。
      // 播完了浏览器也会发一次 pause，那不是卡住，是听完了 —— 必须滤掉。
      if (!audio.ended) onPauseRef.current?.();
    };

    const onEnded = () => {
      setPlaying(false);
      onPlayingChangeRef.current(false);
    };

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPauseEvent);
    audio.addEventListener("ended", onEnded);

    // preload="metadata" 可能在 effect 挂上之前就读完了，那一发事件会错过
    if (audio.readyState >= 1) onMeta();

    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPauseEvent);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  // D4：MediaSession 元数据 —— 让锁屏 / 控制中心显示"在听什么"，
  // 并接住系统那对播放键。D4 明说不追后台播放能力，这里只做"信息与按键正确"。
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: source.title ?? "未命名节目",
      artist: "Fermata",
    });
    const bindings: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void audioRef.current?.play().catch(() => {})],
      ["pause", () => audioRef.current?.pause()],
      ["seekbackward", () => seekBy(-SKIP_S)],
      ["seekforward", () => seekBy(SKIP_S)],
    ];
    for (const [action, handler] of bindings) {
      // 老 Safari 遇到不认识的 action 会抛，别让一个按键拖垮整个播放器
      try {
        ms.setActionHandler(action, handler);
      } catch {}
    }
    return () => {
      for (const [action] of bindings) {
        try {
          ms.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [source.title, seekBy]);

  if (!audioUrl) {
    return (
      <div className="rounded-2xl border border-ink-700 p-5 text-sm text-ink-300">
        这条播客没存下音频地址，删掉重新导入一次试试。
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
      <audio ref={audioRef} src={audioUrl} preload="metadata" playsInline />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
          className="teal-halo flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-teal-400 text-xl text-teal-950"
        >
          <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
        </button>

        <p className="ui-mono ml-auto text-sm text-ink-100">
          <span ref={clockRef}>{mmss(source.last_position_s ?? 0)}</span>
          <span className="text-ink-500"> / {durationS ? mmss(durationS) : "--:--"}</span>
        </p>
      </div>

      <input
        ref={seekRef}
        type="range"
        min={0}
        max={durationS || 0}
        step={1}
        defaultValue={0}
        aria-label="播放进度"
        disabled={!durationS}
        onPointerDown={() => {
          draggingRef.current = true;
        }}
        onChange={(e) => {
          // 拖动时先只更新时间文字；真正 seek 等松手（下面的 commit）
          if (clockRef.current) clockRef.current.textContent = mmss(Number(e.target.value));
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          const audio = audioRef.current;
          if (audio) audio.currentTime = Number((e.target as HTMLInputElement).value);
        }}
        onKeyUp={(e) => {
          const audio = audioRef.current;
          if (audio) audio.currentTime = Number((e.target as HTMLInputElement).value);
        }}
        className="mt-4 h-6 w-full cursor-pointer appearance-none bg-transparent disabled:opacity-40 [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-ink-700 [&::-webkit-slider-thumb]:mt-[-0.4rem] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-teal-400 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-teal-400 [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-ink-700"
      />
    </div>
  );
}

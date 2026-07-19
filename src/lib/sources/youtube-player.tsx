"use client";

import { useCallback, useEffect, useRef } from "react";
import Script from "next/script";
import type { PlayerProps } from "./types";

// YouTube 官方 IFrame Player API 的最小类型声明。
// 不装 @types/youtube —— M1 只用到这几个方法，多一个依赖不如多五行声明。
interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * iframe_api 这个脚本本身只是个加载器：它异步再拉一个 widget 脚本，
 * 等 YT.Player 真正可用时才调 window.onYouTubeIframeAPIReady。
 * 所以「脚本 onReady」≠「YT.Player 可用」，必须两段都等。
 * 而二次挂载（路由来回切）时脚本已在，回调不会再触发 —— 故先查 YT.Player 是否已就绪。
 */
function whenYouTubeApiReady(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.YT?.Player) {
    callback();
    return () => {};
  }
  let cancelled = false;
  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    previous?.();
    if (!cancelled) callback();
  };
  return () => {
    cancelled = true;
  };
}

export function YouTubePlayer({ source, onReady, onPlayingChange, onPause }: PlayerProps) {
  // React 只拥有这个 host div；真正给 YT 的挂载点是我们手动 append 的子节点。
  // 因为 new YT.Player(el) 会把 el 整个替换成 iframe —— 如果那是 React 渲染的节点，
  // 卸载时 React 会去找一个已经不存在的孩子，直接抛 removeChild 错误。
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const cancelWaitRef = useRef<(() => void) | null>(null);

  // 回调存进 ref：父组件每次重渲染都会给新函数引用，
  // 不这样做的话 boot 的依赖会变，播放器被反复销毁重建。
  const onReadyRef = useRef(onReady);
  const onPlayingChangeRef = useRef(onPlayingChange);
  const onPauseRef = useRef(onPause);
  useEffect(() => {
    onReadyRef.current = onReady;
    onPlayingChangeRef.current = onPlayingChange;
    onPauseRef.current = onPause;
  });

  const videoId = source.external_id ?? "";

  const boot = useCallback(() => {
    cancelWaitRef.current?.();
    cancelWaitRef.current = whenYouTubeApiReady(() => {
      const host = hostRef.current;
      const YT = window.YT;
      if (!host || !YT || !videoId || playerRef.current) return;

      const mount = document.createElement("div");
      host.appendChild(mount);

      playerRef.current = new YT.Player(mount, {
        videoId,
        playerVars: {
          // ① 这条是整个 M1 的地基：不加，iOS 会强制拉起系统全屏播放器，
          //    悬浮球（1b）被盖死，捕获交互无处安放。
          playsinline: 1,
          // ② IFrame API 的安全要求，线上不加会被拒连
          origin: window.location.origin,
          // ③ 保留官方控件 —— D15/§10 合规红线：只走官方 embed，不魔改播放体验
          controls: 1,
          enablejsapi: 1,
        },
        events: {
          onReady: () => {
            const player = playerRef.current;
            if (!player) return;
            onReadyRef.current({
              getCurrentTime: () => player.getCurrentTime() || 0,
              getDuration: () => player.getDuration() || 0,
              seekTo: (seconds) => player.seekTo(Math.max(0, seconds), true),
              play: () => player.playVideo(),
              pause: () => player.pauseVideo(),
            });
          },
          onStateChange: (e) => {
            onPlayingChangeRef.current(e.data === YT.PlayerState.PLAYING);
            // 只有 PAUSED 才算"用户按了暂停"。BUFFERING / ENDED / CUED 同样会让
            // playing 变 false，但那不是求助信号，不能拿来弹打断面板。
            if (e.data === YT.PlayerState.PAUSED) onPauseRef.current?.();
          },
        },
      });
    });
  }, [videoId]);

  useEffect(() => {
    return () => {
      cancelWaitRef.current?.();
      cancelWaitRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-ink-700 bg-black">
      <div className="aspect-video w-full [&_iframe]:h-full [&_iframe]:w-full" ref={hostRef} />
      <Script
        id="youtube-iframe-api"
        src="https://www.youtube.com/iframe_api"
        // onReady（而非 onLoad）：脚本首次加载后触发，且此后每次组件挂载都会再触发一次。
        // 从 /watch 列表进来又退回去再进来，播放器要能重新建起来 —— 靠的就是它。
        onReady={boot}
      />
    </div>
  );
}

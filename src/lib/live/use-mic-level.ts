"use client";

import { useEffect, useRef } from "react";

// M1 1b：把 live-console 里"音量→球体"这套口径抽出来，悬浮球与访谈控制台共用。
// 目的不是共用采集通路（live-console 还要把原始 PCM 送去 Live，那是它自己的事），
// 而是共用**同一份 RMS 计算 + 同一个静息门限 + 同一条放大曲线** —— 否则两处
// 各调各的阈值，日后球体在两个界面胖瘦不一。

/**
 * 静息门限：RMS 低于它就当没人在说话（透明度回落、不记为出声）。
 * live-console 与悬浮球引用同一个常量，避免两处阈值走偏。
 */
export const MIC_ACTIVE_RMS = 0.02;

/** 一帧采样的均方根音量。两处共用同一份计算。 */
export function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * RMS → 球体放大倍数，封顶 1.7（约 +39px 摆幅）。
 * 悬浮球写进独立的 `scale` 属性、live-console 写进 `transform: scale()`，
 * 数值口径必须一致 —— 所以这条曲线只有这一处。
 */
export function micLevelToScale(rms: number): number {
  return 1 + Math.min(rms * 8, 0.7);
}

/**
 * 按需麦克风音量表。`active` 为真时申请麦克风、按帧回调实时 RMS；转假或
 * 组件卸载时立刻停掉 track、关掉音频通路 —— 麦克风不常开，省成本也保隐私
 * （WORKORDER §M1 创始人增补）。
 *
 * 只出音量。测音量用 AnalyserNode 足矣，不必像 live-console 那样上
 * AudioWorklet —— 后者存在只是因为要把原始 PCM 送去 Live，这里不需要。
 */
export function useMicLevel(
  active: boolean,
  onLevel: (rms: number) => void,
): void {
  // onLevel 每次渲染都可能是新函数，用 ref 中转，免得重挂麦克风
  const onLevelRef = useRef(onLevel);
  useEffect(() => {
    onLevelRef.current = onLevel;
  }, [onLevel]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let raf = 0;

    (async () => {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        // 申请期间用户可能已经松手：每个 await 之后都要回头看 cancelled
        if (cancelled) {
          mic.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = mic;

        const audioCtx = new AudioContext();
        if (audioCtx.state === "suspended") await audioCtx.resume();
        if (cancelled) {
          mic.getTracks().forEach((t) => t.stop());
          void audioCtx.close();
          return;
        }
        ctx = audioCtx;

        const source = audioCtx.createMediaStreamSource(mic);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser); // 旁路取样，不接 destination —— 不外放，只测量

        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          onLevelRef.current(computeRms(buf));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // 权限被拒 / 没有麦克风：静默失败，悬浮球退回不脉动（长按仍有别的反馈）
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [active]);
}

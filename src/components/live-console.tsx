"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import {
  PcmPlaybackQueue,
  downsampleTo16k,
  floatToPcm16Base64,
  pcm16Base64ToFloat,
  recorderWorkletUrl,
} from "@/lib/live/audio";
import { MIC_ACTIVE_RMS, computeRms, micLevelToScale } from "@/lib/live/use-mic-level";
import { useCopy } from "@/components/copy-provider";
import type { Translate } from "@/lib/copy";

// M0.5 Live 通路 spike — 验收三条硬标准：
//   ① 与 Live 完成 2 分钟中英混说对话（计时器满 2:00 亮绿牌）
//   ② 双向字幕逐词上屏：正在说的话浮在球下（用户青色靠右、模型灰色靠左），
//      说完才汇入对话框
//   ③ 用户随时插话可打断（本地立即静音 + 服务端 interrupted 确认）

type Status = "idle" | "connecting" | "live" | "ended";

// Live API 预置音色（完整 30 个可在 AI Studio 试听，这里精选 8 个）
// 音色在一次会话内固定不变；换音色要重新开始对话。
// 名字（Puck / Kore …）是 Live API 的专有名词，不翻；后面那句描述要翻
const VOICES = [
  { name: "Puck", labelKey: "live.voicePuck" },
  { name: "Charon", labelKey: "live.voiceCharon" },
  { name: "Fenrir", labelKey: "live.voiceFenrir" },
  { name: "Orus", labelKey: "live.voiceOrus" },
  { name: "Kore", labelKey: "live.voiceKore" },
  { name: "Aoede", labelKey: "live.voiceAoede" },
  { name: "Leda", labelKey: "live.voiceLeda" },
  { name: "Zephyr", labelKey: "live.voiceZephyr" },
] as const;

interface CaptionTurn {
  id: number;
  role: "user" | "model";
  text: string;
  interrupted?: boolean;
}

// 对话框只放说完的整句；正在说的两句（一人一句）挂在悬浮球下逐词长
interface Captions {
  turns: CaptionTurn[];
  pendingUser: string;
  pendingModel: string;
}

const EMPTY_CAPTIONS: Captions = { turns: [], pendingUser: "", pendingModel: "" };

/** 把连接期的原始报错翻译成人话。D44：每条对应一个真起因，顺序不能乱 */
function friendlyLiveError(raw: string, t: Translate): string {
  const msg = raw || "";
  if (/NotAllowedError|Permission denied|denied/i.test(msg)) {
    return t("live.errMicDenied");
  }
  if (/NotFoundError|no.*device/i.test(msg)) {
    return t("live.errNoMic");
  }
  if (/quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return t("live.errQuota");
  }
  if (/not found|does not exist|NOT_FOUND/i.test(msg)) {
    return t("live.errNoModel", msg);
  }
  return msg;
}

export function LiveConsole({ geminiConfigured }: { geminiConfigured: boolean }) {
  const t = useCopy();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [interruptCount, setInterruptCount] = useState(0);
  const [captions, setCaptions] = useState<Captions>(EMPTY_CAPTIONS);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ name: string; displayName: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [voice, setVoice] = useState<string>("Puck");
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const playbackRef = useRef<PcmPlaybackQueue | null>(null);
  const recCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedByUserRef = useRef(false);
  const tokenRef = useRef(""); // uses:1 的一次性票；每次新会话都要换新票
  const modelRef = useRef(""); // 本次会话实际连的模型（连接期以它为准，不依赖 state 时序）
  const resumeHandleRef = useRef("");
  const reconnectsRef = useRef(0);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastVoiceAtRef = useRef(0); // 用户最后一次出声的时刻（测响应耗时用）
  const modelSpeakingRef = useRef(false);
  const localMuteRef = useRef(false); // 本地抢闭嘴后，丢掉本轮剩余音频块
  const voiceFramesRef = useRef(0); // 连续有人声的帧数（防噪声误触发抢闭嘴）
  const orbRef = useRef<HTMLDivElement | null>(null); // 音量波动球，直改 DOM 不走 React 渲染

  // ── 字幕状态机：pending（球下逐词长）→ turns（对话框定稿） ──
  const appendUserCaption = useCallback((chunk: string) => {
    setCaptions((c) => ({ ...c, pendingUser: c.pendingUser + chunk }));
  }, []);

  // 模型一开口，就当用户那句说完了：用户气泡先汇入对话框
  const flushUserCaption = useCallback(() => {
    setCaptions((c) =>
      c.pendingUser
        ? {
            ...c,
            pendingUser: "",
            turns: [
              ...c.turns,
              { id: nextIdRef.current++, role: "user", text: c.pendingUser },
            ],
          }
        : c,
    );
  }, []);

  const appendModelCaption = useCallback(
    (chunk: string) => {
      flushUserCaption();
      setCaptions((c) => ({ ...c, pendingModel: c.pendingModel + chunk }));
    },
    [flushUserCaption],
  );

  const flushModelCaption = useCallback((interrupted: boolean) => {
    setCaptions((c) =>
      c.pendingModel
        ? {
            ...c,
            pendingModel: "",
            turns: [
              ...c.turns,
              { id: nextIdRef.current++, role: "model", text: c.pendingModel, interrupted },
            ],
          }
        : c,
    );
  }, []);

  const flushAllCaptions = useCallback(() => {
    setCaptions((c) => {
      if (!c.pendingUser && !c.pendingModel) return c;
      const turns = [...c.turns];
      if (c.pendingUser) {
        turns.push({ id: nextIdRef.current++, role: "user", text: c.pendingUser });
      }
      if (c.pendingModel) {
        turns.push({ id: nextIdRef.current++, role: "model", text: c.pendingModel });
      }
      return { turns, pendingUser: "", pendingModel: "" };
    });
  }, []);

  // ── 音频通路：Context / worklet 整个页面只建一次，跨会话复用 ──
  // 之前每次会话都重建 AudioContext，iOS 的音频路由被反复切换，
  // 第二次会话就开始抽风（回声消除失灵、声音迟滞）。麦克风流仍然
  // 每次会话重新申请、一结束就还——隐私优先。
  const onMicChunk = (e: MessageEvent<Float32Array>) => {
    const recCtx = recCtxRef.current;
    if (!recCtx) return;
    const pcm = downsampleTo16k(e.data, recCtx.sampleRate);
    // 音量口径（RMS + 静息门限 + 放大曲线）抽到 use-mic-level，与悬浮球共用一份
    const rms = computeRms(pcm);
    if (rms > MIC_ACTIVE_RMS) {
      lastVoiceAtRef.current = performance.now();
    }
    // 本地抢闭嘴：模型正在出声时，用户连续 ~130ms 出声就立刻静音，
    // 不等服务器的 interrupted 确认（网络一来一回要几百毫秒，且回声
    // 消除会把用户压小声导致服务器听漏——"越聊越打断不动"的主因）。
    voiceFramesRef.current = rms > 0.03 ? voiceFramesRef.current + 1 : 0;
    if (
      voiceFramesRef.current >= 3 &&
      !localMuteRef.current &&
      playbackRef.current?.playing
    ) {
      localMuteRef.current = true;
      playbackRef.current.interrupt();
    }
    // 悬浮球随音量波动（每 ~40ms 一帧，直改 DOM，不触发 React 重渲染）
    // 球径 56px、外圈 96px：静息小一圈（创始人 2026-07-19：球太大了），
    // 但摆幅按绝对像素保住 —— 放大到 1.7 倍（约 95px）仍是 ~39px 的涨落。
    if (orbRef.current) {
      orbRef.current.style.transform = `scale(${micLevelToScale(rms).toFixed(3)})`;
      orbRef.current.style.opacity = rms > MIC_ACTIVE_RMS ? "1" : "0.55";
    }
    const s = sessionRef.current;
    if (!s) return;
    s.sendRealtimeInput({
      audio: { data: floatToPcm16Base64(pcm), mimeType: "audio/pcm;rate=16000" },
    });
  };

  async function ensureAudio() {
    // 播放通路（在用户点击手势里 resume，iOS 才出声）
    if (!playbackRef.current) playbackRef.current = new PcmPlaybackQueue();
    await playbackRef.current.resume();
    // 采集通路：回声消除必须开，不然扬声器的模型声音会被麦克风听见
    if (!recCtxRef.current) {
      const recCtx = new AudioContext();
      recCtxRef.current = recCtx;
      const workletUrl = recorderWorkletUrl();
      await recCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);
      const recorder = new AudioWorkletNode(recCtx, "pcm-recorder");
      recorder.port.onmessage = onMicChunk;
      recorderRef.current = recorder;
      // 静音 gain 兜底：保证 worklet 在渲染图里被驱动，又不会自己听到自己
      const mute = recCtx.createGain();
      mute.gain.value = 0;
      recorder.connect(mute);
      mute.connect(recCtx.destination);
    } else if (recCtxRef.current.state === "suspended") {
      await recCtxRef.current.resume();
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    const source = recCtxRef.current.createMediaStreamSource(stream);
    sourceRef.current = source;
    source.connect(recorderRef.current!);
  }

  // 会话级清理：断 WS、还麦克风、挂起（不销毁）音频通路
  const stopSessionAudio = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      sessionRef.current?.close();
    } catch {
      // 已断开时 close 会抛错，忽略
    }
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    playbackRef.current?.suspend().catch(() => {});
    recCtxRef.current?.suspend().catch(() => {});
  }, []);

  // 组件卸载：连 Context 一起销毁
  const teardownAll = useCallback(() => {
    stopSessionAudio();
    recorderRef.current = null;
    recCtxRef.current?.close().catch(() => {});
    recCtxRef.current = null;
    playbackRef.current?.close().catch(() => {});
    playbackRef.current = null;
  }, [stopSessionAudio]);

  useEffect(() => teardownAll, [teardownAll]);

  const handleMessage = useCallback(
    (msg: LiveServerMessage) => {
      // 断线续会话的凭据（WORKORDER 风险表：resumption 官方路径，M0.5 落地）
      const update = msg.sessionResumptionUpdate;
      if (update?.resumable && update.newHandle) {
        resumeHandleRef.current = update.newHandle;
      }
      if (msg.goAway) {
        setNotice(t("live.reclaim"));
      }

      const sc = msg.serverContent;
      if (!sc) return;

      // ③ 用户插话 → 服务端确认打断：清播放队列，解除本地静音
      if (sc.interrupted) {
        playbackRef.current?.interrupt();
        modelSpeakingRef.current = false;
        localMuteRef.current = false;
        flushModelCaption(true);
        setInterruptCount((n) => n + 1);
        return;
      }
      // ② 双向字幕逐词长在球下的 pending 气泡里
      if (sc.inputTranscription?.text) appendUserCaption(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) appendModelCaption(sc.outputTranscription.text);

      // 模型语音：逐块排进播放队列。每轮的第一块顺便记一次响应耗时
      for (const part of sc.modelTurn?.parts ?? []) {
        const b64 = part.inlineData?.data;
        if (typeof b64 === "string" && b64.length > 0) {
          if (!modelSpeakingRef.current) {
            modelSpeakingRef.current = true;
            flushUserCaption();
            const dt = performance.now() - lastVoiceAtRef.current;
            if (lastVoiceAtRef.current > 0 && dt < 15000) setLastLatencyMs(dt);
          }
          if (!localMuteRef.current) {
            playbackRef.current?.enqueue(pcm16Base64ToFloat(b64));
          }
        }
      }
      if (sc.turnComplete) {
        modelSpeakingRef.current = false;
        localMuteRef.current = false;
        flushAllCaptions();
      }
    },
    [appendUserCaption, appendModelCaption, flushUserCaption, flushModelCaption, flushAllCaptions, t],
  );

  // 找服务端要一次性通行证（真钥匙不出服务器 — D13）
  const fetchToken = useCallback(
    async (modelName: string): Promise<{ token: string; model: string }> => {
      const res = await fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("live.tokenFailed", res.status));
      return body;
    },
    [t],
  );

  // 断线重连要在 onclose 回调里调用 openSession 自己 —— 经 ref 转一手避免自引用
  const openSessionRef = useRef<(() => Promise<void>) | null>(null);

  const openSession = useCallback(async () => {
    // uses:1 的票不保证第二次连接还能用，续接前先换一张新票
    if (reconnectsRef.current > 0) {
      tokenRef.current = (await fetchToken(modelRef.current)).token;
    }
    const model = modelRef.current;
    const ai = new GoogleGenAI({ apiKey: tokenRef.current, apiVersion: "v1alpha" });
    const session = await ai.live.connect({
      model,
      callbacks: {
        onmessage: handleMessage,
        onerror: (e) => setError(friendlyLiveError(e.message ?? t("live.connError"), t)),
        onclose: (e) => {
          sessionRef.current = null;
          if (closedByUserRef.current) return;
          // 意外断线：有续接凭据就自动重连（最多 2 次），对话状态不丢
          if (resumeHandleRef.current && reconnectsRef.current < 2) {
            reconnectsRef.current += 1;
            setNotice(t("live.reconnecting", reconnectsRef.current));
            openSessionRef.current?.().catch((err) =>
              setError(friendlyLiveError(err instanceof Error ? err.message : String(err), t)),
            );
          } else {
            setStatus("ended");
            setError(
              e.reason
                ? t("live.closedWith", e.reason)
                : t("live.closed"),
            );
          }
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // 音色整场固定（创始人需求：一次对话内声音一致）
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
        // 语音对话追求秒回：native-audio 系模型默认边想边停顿，思考预算清零
        ...(model.includes("native-audio")
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
        realtimeInputConfig: {
          automaticActivityDetection: {
            // 插话检测调到最灵（对付"聊到后面打断不动"）
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
            // "说完了"判定默认要等约 1 秒静音，压到 400ms 换更快的接话
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
            silenceDurationMs: 400,
          },
        },
        // 官方超时缓解路径：滑动窗口压缩 + 会话续接
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: resumeHandleRef.current
          ? { handle: resumeHandleRef.current }
          : {},
        systemInstruction:
          "你是 Fermata 的语音对话伙伴。用户会中英文混着说，用户用哪种语言你就用哪种语言回应，可以自然地中英混用。回答口语化、简短（两三句以内），像朋友聊天。",
      },
    });
    sessionRef.current = session;
    setNotice("");
    // `t` 进依赖是安全的：openSession 只被 `openSessionRef` 那个 effect 读走（写个 ref
    // 而已），真正建连是用户点「开始语音对话」触发的 —— 切界面语言不会自己去连一次
  }, [voice, handleMessage, fetchToken, t]);

  useEffect(() => {
    openSessionRef.current = openSession;
  }, [openSession]);

  // 从点击到 live 一条顺序流水线，不再经由 useEffect 触发。
  // 之前靠"setModel → useEffect 建连"：第二次会话时 model 还是旧值、
  // effect 立刻用**已经消耗过的旧票**去连，新票白领——这就是"第二次
  // 对话要等 30 秒才回、有时干脆不回"的根因。
  async function connect() {
    setError("");
    setNotice("");
    setCaptions(EMPTY_CAPTIONS);
    setInterruptCount(0);
    setLastLatencyMs(null);
    closedByUserRef.current = false;
    reconnectsRef.current = 0;
    resumeHandleRef.current = "";
    lastVoiceAtRef.current = 0;
    modelSpeakingRef.current = false;
    localMuteRef.current = false;
    voiceFramesRef.current = 0;
    setStatus("connecting");

    try {
      // 1) 先在用户手势里点亮音频通路（iOS 出声要求）
      await ensureAudio();
      // 2) 领新的一次性通行证（带上下拉框选中的模型）
      const body = await fetchToken(selectedModel);
      tokenRef.current = body.token;
      modelRef.current = body.model;
      setModel(body.model);
      // 3) 建立 WS
      await openSession();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      setStatus("live");
    } catch (e) {
      stopSessionAudio();
      setStatus("idle");
      setError(friendlyLiveError(e instanceof Error ? e.message : String(e), t));
    }
  }

  function disconnect() {
    closedByUserRef.current = true;
    stopSessionAudio();
    flushAllCaptions();
    setStatus("ended");
  }

  // 文字调试通道：没麦克风的环境（或想安静测试）也能验证整条链路
  function sendText(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const s = sessionRef.current;
    if (!text || !s) return;
    setCaptions((c) => ({
      ...c,
      turns: [...c.turns, { id: nextIdRef.current++, role: "user", text }],
    }));
    lastVoiceAtRef.current = performance.now(); // 文字轮也计响应耗时
    s.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
    setDraft("");
  }

  // 新字幕来了自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions]);

  // 拉取当前 API Key 可用的 Live 模型列表，恢复上次选择
  useEffect(() => {
    if (!geminiConfigured) return;
    (async () => {
      try {
        const res = await fetch("/api/live-models");
        if (!res.ok) return;
        const body: {
          models: { name: string; displayName: string }[];
          default: string;
        } = await res.json();
        setModels(body.models ?? []);
        const saved = localStorage.getItem("fermata-live-model");
        const names = (body.models ?? []).map((m) => m.name);
        setSelectedModel(saved && names.includes(saved) ? saved : body.default);
        const savedVoice = localStorage.getItem("fermata-live-voice");
        if (savedVoice && VOICES.some((v) => v.name === savedVoice)) {
          setVoice(savedVoice);
        }
      } catch {
        // 列表拿不到就用服务端默认模型，不挡对话
      }
    })();
  }, [geminiConfigured]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  if (!geminiConfigured) {
    return (
      <main className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="w-full max-w-sm rounded-[1.75rem] border border-ink-500/50 bg-ink-700 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
          <div className="teal-halo mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-teal-600/60 text-3xl text-teal-300" aria-hidden>⌁</div>
          <p className="mt-6 text-lg font-semibold text-ink-100">{t("live.notReadyTitle")}</p>
          <p className="mt-3 text-sm leading-6 text-ink-300">
            {t("live.notReadyBodyA")} <code className="rounded-md bg-ink-900 px-1.5 py-0.5 text-teal-300">GEMINI_API_KEY</code>
            {t("live.notReadyBodyB")}
          </p>
          <p className="mt-5 border-t border-ink-500/30 pt-4 text-xs leading-5 text-ink-500">
            {t("live.notReadyHint")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="pb-nav relative flex min-h-0 flex-1 flex-col px-5 sm:px-8">
      {/* 抬头 + 状态徽章 */}
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div>
          <p className="eyebrow mb-1">conversation deck</p>
          <h1 className="display-serif text-lg text-ink-100 sm:text-xl">{t("live.title")}</h1>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 text-[0.68rem]">
          <span className={`ui-mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${status === "live" ? "border-teal-600/70 bg-teal-950 text-teal-300" : "border-ink-500/50 text-ink-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "animate-pulse bg-teal-400" : "bg-ink-500"}`} />
            {status === "idle" && t("live.statusIdle")}
            {status === "connecting" && t("live.statusConnecting")}
            {status === "live" && `${mm}:${ss}`}
            {status === "ended" && t("live.statusEnded", `${mm}:${ss}`)}
          </span>
          {interruptCount > 0 && <span className="ui-mono rounded-full border border-ink-500/50 px-2.5 py-1 text-ink-300">{t("live.interrupts", interruptCount)}</span>}
          {lastLatencyMs !== null && <span className="ui-mono rounded-full border border-ink-500/50 px-2.5 py-1 text-ink-300">{t("live.latency", (lastLatencyMs / 1000).toFixed(1))}</span>}
          {elapsed >= 120 && <span className="ui-mono rounded-full border border-teal-600/70 bg-teal-950 px-2.5 py-1 text-teal-300">✓ 2 min</span>}
        </div>
      </div>

      {/* 悬浮球：说话时随音量波动；正在说的话逐词长在球下 —— 用户青色
          靠右、模型灰色靠左，各自说完才汇入下面的对话框 */}
      {status === "live" && (
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="relative flex h-24 w-24 items-center justify-center" aria-label={t("live.listeningAria")}>
            <div className="absolute inset-0 animate-pulse rounded-full border border-teal-600/40" />
            <div
              ref={orbRef}
              className="teal-halo h-14 w-14 rounded-full bg-teal-400 opacity-55 transition-transform duration-100"
              aria-hidden
            />
          </div>
          {captions.pendingUser || captions.pendingModel ? (
            <div className="flex w-full flex-col gap-2">
              {captions.pendingModel && (
                <p className="caption-copy mr-auto max-w-[88%] rounded-2xl bg-ink-900 px-4 py-3 text-sm leading-6 text-ink-100">
                  {captions.pendingModel}
                  <span className="animate-pulse text-teal-400">▍</span>
                </p>
              )}
              {captions.pendingUser && (
                <p className="caption-copy ml-auto max-w-[88%] rounded-2xl bg-teal-950 px-4 py-3 text-sm leading-6 text-teal-100">
                  {captions.pendingUser}
                  <span className="animate-pulse text-teal-400">▍</span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-500">{t("live.listening")}</p>
          )}
        </div>
      )}

      {/* 对话框：只收说完的整句 */}
      <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="caption-title">
        <div className="mb-2 flex items-center justify-between px-1">
          <p id="caption-title" className="eyebrow">{t("live.captionsTitle")}</p>
          <span className="ui-mono text-[0.68rem] text-ink-500">
            {captions.turns.length ? t("live.turns", captions.turns.length) : t("live.waitingFirst")}
          </span>
        </div>
        {/* 手机上聊天框吃满至少 55vh —— 它是主角，其余部件让位（创始人 2026-07-19） */}
        <div
          ref={scrollRef}
          className="min-h-[55svh] min-w-0 flex-1 space-y-3 overflow-y-auto rounded-[1.5rem] border border-ink-500/50 bg-ink-700 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.16)] sm:min-h-[11rem] sm:p-5"
        >
          {captions.turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center px-3 text-center">
              <span className="mb-4 text-2xl text-teal-300" aria-hidden>⌁</span>
              <p className="max-w-sm text-sm leading-6 text-ink-300">
                {status === "live"
                  ? t("live.emptyLive")
                  : t("live.emptyIdle")}
              </p>
            </div>
          )}
          {/* 形参叫 `turn` 不叫 `t` —— `t` 是翻译函数，同名会把它遮住 */}
          {captions.turns.map((turn) => (
            <div
              key={turn.id}
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                turn.role === "user" ? "ml-auto bg-teal-950 text-teal-100" : "mr-auto bg-ink-900 text-ink-100"
              }`}
            >
              <div className="eyebrow mb-1.5 text-[0.65rem]">{turn.role === "user" ? t("live.roleYou") : t("live.roleAssistant")}</div>
              <span className="caption-copy">{turn.text}</span>
              {turn.interrupted && <span className="ml-2 text-xs text-ink-500">{t("live.interrupted")}</span>}
            </div>
          ))}
        </div>
      </section>

      {notice && <p className="mt-2 px-1 text-xs leading-5 text-ink-300">↻ {notice}</p>}
      {error && (
        <p className="mt-2 rounded-xl border border-ink-500/50 bg-ink-700 px-3 py-2 text-sm leading-5 text-teal-300" role="alert">
          {error}
        </p>
      )}

      {/* 控制区 */}
      <div className="glass mt-2 rounded-[1.5rem] p-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.28)] sm:mt-3 sm:p-3">
        {status === "live" ? (
          <>
            <form onSubmit={sendText} className="flex gap-2">
              <label htmlFor="debug-message" className="sr-only">{t("live.sendTextLabel")}</label>
              <input
                id="debug-message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("live.textPlaceholder")}
                className="min-w-0 flex-1 rounded-xl border border-ink-500/60 bg-ink-900 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-teal-400"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="min-h-11 rounded-xl border border-ink-500/60 px-4 text-sm font-semibold text-ink-300 hover:border-teal-400 hover:text-teal-300 disabled:opacity-40"
              >
                {t("live.send")}
              </button>
            </form>
            <button
              type="button"
              onClick={disconnect}
              className="mt-2 min-h-11 w-full rounded-xl border border-ink-500/60 text-sm font-semibold text-ink-300 hover:border-teal-400 hover:text-teal-300"
            >
              {t("live.end")}
            </button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {models.length > 0 && (
                <label className="min-w-0">
                  <span className="eyebrow mb-1.5 block px-1 text-[0.65rem]">model</span>
                  <select
                    value={selectedModel}
                    onChange={(e) => {
                      setSelectedModel(e.target.value);
                      localStorage.setItem("fermata-live-model", e.target.value);
                    }}
                    className="picker h-10 w-full min-w-0 rounded-xl border border-ink-500/60 bg-ink-900 px-3 text-ink-100 outline-none focus:border-teal-400"
                  >
                    {models.map((m) => (
                      <option key={m.name} value={m.name}>{m.displayName}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className={models.length > 0 ? "min-w-0" : "col-span-2 min-w-0"}>
                <span className="eyebrow mb-1.5 block px-1 text-[0.65rem]">{t("live.voice")}</span>
                <select
                  value={voice}
                  onChange={(e) => {
                    setVoice(e.target.value);
                    localStorage.setItem("fermata-live-voice", e.target.value);
                  }}
                  className="picker h-10 w-full min-w-0 rounded-xl border border-ink-500/60 bg-ink-900 px-3 text-ink-100 outline-none focus:border-teal-400"
                >
                  {VOICES.map((v) => (
                    <option key={v.name} value={v.name}>{t(v.labelKey)}</option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={connect}
              disabled={status === "connecting"}
              className="mt-1.5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 font-semibold text-teal-950 hover:bg-teal-300 disabled:opacity-50"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-teal-950/30 text-sm" aria-hidden>◉</span>
              {status === "connecting"
                ? t("live.connecting")
                : status === "ended"
                  ? t("live.restart")
                  : t("live.start")}
            </button>
          </>
        )}
        {model && <p className="ui-mono mt-2 truncate px-1 text-center text-[0.65rem] text-ink-500">{model}</p>}
      </div>
    </main>
  );
}

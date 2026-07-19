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

// M0.5 Live 通路 spike — 验收三条硬标准：
//   ① 与 Live 完成 2 分钟中英混说对话（计时器满 2:00 亮绿牌）
//   ② 双向字幕逐词上屏：正在说的话浮在球下（用户青色靠右、模型灰色靠左），
//      说完才汇入对话框
//   ③ 用户随时插话可打断（本地立即静音 + 服务端 interrupted 确认）

type Status = "idle" | "connecting" | "live" | "ended";

// Live API 预置音色（完整 30 个可在 AI Studio 试听，这里精选 8 个）
// 音色在一次会话内固定不变；换音色要重新开始对话。
const VOICES = [
  { name: "Puck", label: "Puck · 偏男声，活泼" },
  { name: "Charon", label: "Charon · 偏男声，低沉" },
  { name: "Fenrir", label: "Fenrir · 偏男声，带劲" },
  { name: "Orus", label: "Orus · 偏男声，坚定" },
  { name: "Kore", label: "Kore · 偏女声，沉稳" },
  { name: "Aoede", label: "Aoede · 偏女声，轻快" },
  { name: "Leda", label: "Leda · 偏女声，年轻" },
  { name: "Zephyr", label: "Zephyr · 偏女声，明亮" },
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

/** 把连接期的原始报错翻译成人话 */
function friendlyLiveError(raw: string): string {
  const msg = raw || "";
  if (/NotAllowedError|Permission denied|denied/i.test(msg)) {
    return "麦克风权限被拒绝了。iPhone：设置 → Safari（或该 App）→ 麦克风 → 允许；电脑：点地址栏左边的锁图标允许麦克风。";
  }
  if (/NotFoundError|no.*device/i.test(msg)) {
    return "没找到麦克风设备。";
  }
  if (/quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "Gemini 免费额度暂时用完了，等几分钟再试。";
  }
  if (/not found|does not exist|NOT_FOUND/i.test(msg)) {
    return `模型不存在或已下线：${msg}（可在 Vercel 设 GEMINI_LIVE_MODEL 换一个模型）`;
  }
  return msg;
}

export function LiveConsole({ geminiConfigured }: { geminiConfigured: boolean }) {
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
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / pcm.length);
    if (rms > 0.02) {
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
    if (orbRef.current) {
      orbRef.current.style.transform = `scale(${(1 + Math.min(rms * 5, 0.7)).toFixed(3)})`;
      orbRef.current.style.opacity = rms > 0.02 ? "1" : "0.55";
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
        setNotice("服务器即将回收连接，正在无缝续接…");
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
    [appendUserCaption, appendModelCaption, flushUserCaption, flushModelCaption, flushAllCaptions],
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
      if (!res.ok) throw new Error(body.error ?? `token 接口返回 ${res.status}`);
      return body;
    },
    [],
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
        onerror: (e) => setError(friendlyLiveError(e.message ?? "连接出错")),
        onclose: (e) => {
          sessionRef.current = null;
          if (closedByUserRef.current) return;
          // 意外断线：有续接凭据就自动重连（最多 2 次），对话状态不丢
          if (resumeHandleRef.current && reconnectsRef.current < 2) {
            reconnectsRef.current += 1;
            setNotice(`连接断了，正在第 ${reconnectsRef.current} 次续接…`);
            openSessionRef.current?.().catch((err) =>
              setError(friendlyLiveError(err instanceof Error ? err.message : String(err))),
            );
          } else {
            setStatus("ended");
            setError(
              e.reason
                ? `连接被关闭：${e.reason}`
                : "连接断开了。可以点「重新开始」再来一轮。",
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
  }, [voice, handleMessage, fetchToken]);

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
      setError(friendlyLiveError(e instanceof Error ? e.message : String(e)));
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
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-lg text-ink-100">还差一把钥匙</p>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-300">
          服务器还没配置 <code className="text-teal-300">GEMINI_API_KEY</code>。
          去 aistudio.google.com 免费创建一个 API Key，填到 Vercel 的
          Environment Variables 里再 Redeploy 即可。
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* 状态条：计时 + 验收徽章 */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
            status === "live"
              ? "border-teal-800 text-teal-300"
              : "border-ink-700 text-ink-500"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "live" ? "animate-pulse bg-teal-400" : "bg-ink-500"
            }`}
          />
          {status === "idle" && "未连接"}
          {status === "connecting" && "连接中…"}
          {status === "live" && `通话中 ${mm}:${ss}`}
          {status === "ended" && `已结束 ${mm}:${ss}`}
        </span>
        {elapsed >= 120 && (
          <span className="rounded-full border border-teal-800 bg-teal-950/40 px-3 py-1 text-xs text-teal-300">
            ✓ 已满 2 分钟
          </span>
        )}
        {interruptCount > 0 && (
          <span className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-300">
            打断 {interruptCount} 次
          </span>
        )}
        {lastLatencyMs !== null && (
          <span className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-300">
            响应 {(lastLatencyMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* 悬浮球：说话时随音量波动；正在说的话逐词长在球下 —— 用户青色
          靠右、模型灰色靠左，各自说完才汇入下面的对话框 */}
      {status === "live" && (
        <div className="flex flex-col items-center gap-2 pb-3">
          <div
            ref={orbRef}
            className="h-14 w-14 rounded-full bg-teal-400/90 opacity-55 shadow-[0_0_28px_rgba(93,202,165,0.45)] transition-transform duration-100"
            aria-hidden
          />
          {(captions.pendingUser || captions.pendingModel) && (
            <div className="flex w-full flex-col gap-2">
              {captions.pendingModel && (
                <p className="mr-auto max-w-[85%] rounded-2xl bg-ink-700/60 px-4 py-2.5 text-sm leading-relaxed text-ink-100">
                  {captions.pendingModel}
                  <span className="animate-pulse text-teal-400">▍</span>
                </p>
              )}
              {captions.pendingUser && (
                <p className="ml-auto max-w-[85%] rounded-2xl bg-teal-900/50 px-4 py-2.5 text-sm leading-relaxed text-teal-100">
                  {captions.pendingUser}
                  <span className="animate-pulse text-teal-400">▍</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 对话框：只收说完的整句 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-ink-700 bg-ink-700/20 p-4"
      >
        {captions.turns.length === 0 && (
          <p className="pt-10 text-center text-sm leading-relaxed text-ink-500">
            {status === "live"
              ? "开口说话吧 —— 正在说的话会逐词浮现在上方小球下面，说完一句才落进这里。想验证打断，就在它说话说到一半时插话。"
              : "点下面的按钮开始。需要允许麦克风权限，建议戴耳机。"}
          </p>
        )}
        {captions.turns.map((t) => (
          <div
            key={t.id}
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              t.role === "user"
                ? "ml-auto bg-teal-900/50 text-teal-100"
                : "mr-auto bg-ink-700/60 text-ink-100"
            }`}
          >
            {t.text}
            {t.interrupted && (
              <span className="ml-2 text-xs text-ink-500">（被打断）</span>
            )}
          </div>
        ))}
      </div>

      {notice && <p className="mt-2 text-xs text-ink-300">{notice}</p>}
      {error && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {/* 控制区 */}
      <div className="mt-3 flex flex-col gap-2">
        {status === "live" ? (
          <>
            <form onSubmit={sendText} className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="文字调试通道（可选，说话即可）"
                className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-700/40 px-4 py-2.5 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-teal-600"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="rounded-xl border border-ink-700 px-4 py-2.5 text-sm text-ink-300 transition-colors hover:border-teal-600 hover:text-teal-300 disabled:opacity-40"
              >
                发送
              </button>
            </form>
            <button
              type="button"
              onClick={disconnect}
              className="rounded-xl border border-red-900/60 px-4 py-3 font-medium text-red-400 transition-colors hover:bg-red-950/30"
            >
              结束对话
            </button>
          </>
        ) : (
          <>
            {models.length > 0 && (
              <select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  localStorage.setItem("fermata-live-model", e.target.value);
                }}
                className="rounded-xl border border-ink-700 bg-ink-700/40 px-3 py-2.5 text-sm text-ink-100 outline-none focus:border-teal-600"
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            )}
            <select
              value={voice}
              onChange={(e) => {
                setVoice(e.target.value);
                localStorage.setItem("fermata-live-voice", e.target.value);
              }}
              className="rounded-xl border border-ink-700 bg-ink-700/40 px-3 py-2.5 text-sm text-ink-100 outline-none focus:border-teal-600"
            >
              {VOICES.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className="rounded-xl border border-dashed border-ink-700 px-4 py-2.5 text-center text-xs text-ink-500">
              🎙 Upload your favorite voice — Coming soon
            </p>
            <button
              type="button"
              onClick={connect}
              disabled={status === "connecting"}
              className="rounded-xl bg-teal-400 px-4 py-3 font-semibold text-teal-950 transition-opacity disabled:opacity-60"
            >
              {status === "connecting"
                ? "连接中…"
                : status === "ended"
                  ? "重新开始"
                  : "开始语音对话"}
            </button>
          </>
        )}
        {model && (
          <p className="text-center text-xs text-ink-500">{model}</p>
        )}
      </div>
    </main>
  );
}

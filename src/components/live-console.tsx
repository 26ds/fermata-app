"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  Modality,
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
//   ② 模型语音的字幕逐词上屏（outputTranscription 增量渲染）
//   ③ 用户随时插话可打断（interrupted → 清播放队列，计数上屏）

type Status = "idle" | "connecting" | "live" | "ended";

interface CaptionTurn {
  id: number;
  role: "user" | "model";
  text: string;
  final: boolean;
  interrupted?: boolean;
}

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
  const [turns, setTurns] = useState<CaptionTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");

  const sessionRef = useRef<Session | null>(null);
  const playbackRef = useRef<PcmPlaybackQueue | null>(null);
  const recCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedByUserRef = useRef(false);
  const tokenRef = useRef(""); // uses:1 的票，但断线重连（resumption）不消耗次数，可复用
  const resumeHandleRef = useRef("");
  const reconnectsRef = useRef(0);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 字幕逐词上屏：同角色未定稿的气泡续写，否则起新气泡
  const appendCaption = useCallback(
    (role: "user" | "model", chunk: string) => {
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && !last.final) {
          return [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
        }
        return [...prev, { id: nextIdRef.current++, role, text: chunk, final: false }];
      });
    },
    [],
  );

  const finalizeCaptions = useCallback((markInterrupted = false) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.final
          ? t
          : {
              ...t,
              final: true,
              interrupted: markInterrupted && t.role === "model" ? true : t.interrupted,
            },
      ),
    );
  }, []);

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recCtxRef.current?.close().catch(() => {});
    recCtxRef.current = null;
    playbackRef.current?.close().catch(() => {});
    playbackRef.current = null;
    try {
      sessionRef.current?.close();
    } catch {
      // 已断开时 close 会抛错，忽略
    }
    sessionRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]); // 组件卸载时清理

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

      // ③ 用户插话 → 模型立刻闭嘴：清空播放队列
      if (sc.interrupted) {
        playbackRef.current?.interrupt();
        finalizeCaptions(true);
        setInterruptCount((n) => n + 1);
        return;
      }
      // ② 双向字幕逐词上屏
      if (sc.inputTranscription?.text) appendCaption("user", sc.inputTranscription.text);
      if (sc.outputTranscription?.text) appendCaption("model", sc.outputTranscription.text);

      // 模型语音：逐块排进播放队列
      for (const part of sc.modelTurn?.parts ?? []) {
        const b64 = part.inlineData?.data;
        if (typeof b64 === "string" && b64.length > 0) {
          playbackRef.current?.enqueue(pcm16Base64ToFloat(b64));
        }
      }
      if (sc.turnComplete) finalizeCaptions();
    },
    [appendCaption, finalizeCaptions],
  );

  // 断线重连要在 onclose 回调里调用 openSession 自己 —— 经 ref 转一手避免自引用
  const openSessionRef = useRef<(() => Promise<void>) | null>(null);

  const openSession = useCallback(async () => {
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
  }, [model, handleMessage]);

  useEffect(() => {
    openSessionRef.current = openSession;
  }, [openSession]);

  // model 变化后（首次拿到 token 时）真正建立连接
  useEffect(() => {
    if (status !== "connecting" || !model || sessionRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        await openSession();
        if (cancelled) return;
        setStatus("live");
        setElapsed(0);
        timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      } catch (e) {
        if (cancelled) return;
        teardown();
        setStatus("idle");
        setError(friendlyLiveError(e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, model, openSession, teardown]);

  async function connect() {
    setError("");
    setNotice("");
    setTurns([]);
    setInterruptCount(0);
    closedByUserRef.current = false;
    reconnectsRef.current = 0;
    resumeHandleRef.current = "";
    setStatus("connecting");

    try {
      // 1) 找服务端要一次性通行证（真钥匙不出服务器 — D13）
      const res = await fetch("/api/live-token", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `token 接口返回 ${res.status}`);
      tokenRef.current = body.token;

      // 2) 播放通路（必须在用户点击的手势里创建，iOS 才出声）
      const playback = new PcmPlaybackQueue();
      await playback.resume();
      playbackRef.current = playback;

      // 3) 麦克风 → worklet 攒块 → 重采样 16k → PCM16 base64 → 上行
      //    回声消除必须开：不然扬声器的模型声音会被麦克风听见，触发假打断
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const recCtx = new AudioContext();
      recCtxRef.current = recCtx;
      const workletUrl = recorderWorkletUrl();
      await recCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);
      const source = recCtx.createMediaStreamSource(stream);
      const recorder = new AudioWorkletNode(recCtx, "pcm-recorder");
      recorder.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const s = sessionRef.current;
        if (!s) return;
        const data = floatToPcm16Base64(downsampleTo16k(e.data, recCtx.sampleRate));
        s.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
      };
      // 静音 gain 兜底：保证 worklet 在渲染图里被驱动，又不会自己听到自己
      const mute = recCtx.createGain();
      mute.gain.value = 0;
      source.connect(recorder);
      recorder.connect(mute);
      mute.connect(recCtx.destination);

      // 4) 建立 WS —— 由上面的 useEffect 在 model 就位后执行
      setModel(body.model);
    } catch (e) {
      teardown();
      setStatus("idle");
      setError(friendlyLiveError(e instanceof Error ? e.message : String(e)));
    }
  }

  function disconnect() {
    closedByUserRef.current = true;
    teardown();
    finalizeCaptions();
    setStatus("ended");
  }

  // 文字调试通道：没麦克风的环境（或想安静测试）也能验证整条链路
  function sendText(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const s = sessionRef.current;
    if (!text || !s) return;
    setTurns((prev) => [
      ...prev,
      { id: nextIdRef.current++, role: "user", text, final: true },
    ]);
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
  }, [turns]);

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
      </div>

      {/* 字幕区 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-ink-700 bg-ink-700/20 p-4"
      >
        {turns.length === 0 && (
          <p className="pt-10 text-center text-sm leading-relaxed text-ink-500">
            {status === "live"
              ? "开口说话吧 —— 中文英文随意混，双方字幕会逐词出现在这里。想验证打断，就在它说话说到一半时插话。"
              : "点下面的按钮开始。需要允许麦克风权限，建议戴耳机。"}
          </p>
        )}
        {turns.map((t) => (
          <div
            key={t.id}
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              t.role === "user"
                ? "ml-auto bg-teal-900/50 text-teal-100"
                : "mr-auto bg-ink-700/60 text-ink-100"
            }`}
          >
            {t.text}
            {!t.final && <span className="animate-pulse text-teal-400">▍</span>}
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
        )}
        {model && (
          <p className="text-center text-xs text-ink-500">{model}</p>
        )}
      </div>
    </main>
  );
}

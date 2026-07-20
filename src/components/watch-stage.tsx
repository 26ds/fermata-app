"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaptionLayer } from "@/components/caption-layer";
import { CaptureOrb } from "@/components/capture-orb";
import { DotBar, type InterruptPoint } from "@/components/dot-bar";
import { InterruptPanel } from "@/components/interrupt-panel";
import { playerFor } from "@/lib/sources/players";
import type { PlayerHandle } from "@/lib/sources/types";
import { mmss } from "@/lib/time";
import type { QuestionMode, SourceRow } from "@/lib/types";

/** 进度回写节流：播放中最快 10 秒存一次，别把网络当秒表用 */
const SAVE_EVERY_MS = 10_000;

/**
 * M1 的中枢：拿到 PlayerHandle，持续知道"现在播到第几秒"。
 * 悬浮球（1b）、点点条 + 打断面板（1c）都挂在这里。
 * 它只认 SourceRow + PlayerHandle —— 底下播的是 YouTube 还是播客，这里不知道也不该知道。
 */
export function WatchStage({
  source,
  interrupts,
}: {
  source: SourceRow;
  interrupts: InterruptPoint[];
}) {
  // 只问"用哪个壳"。这条链接是什么平台、叫什么名字，是服务端 registry 的活（M1d）
  const shell = playerFor(source.kind);

  const handleRef = useRef<PlayerHandle | null>(null);
  const currentTimeRef = useRef(0);
  const durationSentRef = useRef(source.duration_s != null);
  const durationKnownRef = useRef((source.duration_s ?? 0) > 0);
  const lastSavedAtRef = useRef(0);
  const lastSavedValueRef = useRef(source.last_position_s ?? 0);
  const clockRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  // 这两个走 ref：暂停回调可能比 state 更新更快，判断必须同步
  const playingRef = useRef(false);
  const panelOpenRef = useRef(false);
  const resumeOnCloseRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [durationS, setDurationS] = useState(source.duration_s ?? 0);
  const [points, setPoints] = useState<InterruptPoint[]>(interrupts);
  const [panel, setPanel] = useState<{ open: boolean; tS: number; id: string | null }>({
    open: false,
    tS: 0,
    id: null,
  });

  // 服务端数据变了（router.refresh 之后）就跟着换。渲染期校正，不用 effect
  const [seen, setSeen] = useState(interrupts);
  if (interrupts !== seen) {
    setSeen(interrupts);
    setPoints(interrupts);
  }

  // 删除失败要回滚到"删之前"，但 handleDelete 得保持稳定身份（点点条按 props 记回调），
  // 所以快照走 ref 而不是把 points 塞进依赖数组
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

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
      playingRef.current = next;
      setPlaying(next);
      // 暂停的那一刻是最该记住的位置
      if (!next) savePosition();
    },
    [savePosition],
  );

  // ── 打断面板的开关 ──
  const openPanel = useCallback((tS: number, id: string | null) => {
    // 同步置位：紧接着的 pause 回调要靠它判断"这是我们自己按停的"
    panelOpenRef.current = true;
    if (playingRef.current) {
      // 是我们把它按停的 → 关面板时恢复播放
      resumeOnCloseRef.current = true;
      handleRef.current?.pause();
    } else {
      // 用户自己停的 → 关面板时别擅自续播
      resumeOnCloseRef.current = false;
    }
    setPanel({ open: true, tS, id });
  }, []);

  const closePanel = useCallback(() => {
    panelOpenRef.current = false;
    setPanel((p) => ({ ...p, open: false }));
    if (resumeOnCloseRef.current) {
      resumeOnCloseRef.current = false;
      handleRef.current?.play();
    }
  }, []);

  /** 用户真的按了暂停（缓冲/播放结束不算，见 PlayerProps.onPause） */
  const handlePause = useCallback(() => {
    if (panelOpenRef.current) return; // 面板已经开着（多半是我们自己按停的）
    openPanel(currentTimeRef.current, null);
  }, [openPanel]);

  const postInterrupt = useCallback(
    async (tS: number, mode: QuestionMode | null): Promise<InterruptPoint> => {
      const res = await fetch("/api/interrupts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, tS, questionMode: mode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "没记下来，请重试");
      return body as InterruptPoint;
    },
    [source.id],
  );

  /** 轻点悬浮球 = 记下这一刻。点先画上去，落库回来再换真 id */
  const captureNow = useCallback(() => {
    const t = currentTimeRef.current;
    openPanel(t, null);
    const tempId = `temp-${Date.now()}`;
    setPoints((prev) => [...prev, { id: tempId, t_s: t, question_mode: null }]);
    void postInterrupt(t, null)
      .then((saved) => {
        setPoints((prev) => prev.map((p) => (p.id === tempId ? saved : p)));
        // 落库成功 → 面板从"还没记"切成"已记下"，chip 改走 PATCH
        setPanel((p) => (p.open && p.id === null ? { ...p, id: saved.id } : p));
      })
      .catch(() => {
        // 没存上就把这个假点撤掉，别留一个点不回去的点。
        // 面板仍开着且 id 还是 null，用户可以在里面重试。
        setPoints((prev) => prev.filter((p) => p.id !== tempId));
      });
  }, [openPanel, postInterrupt]);

  /** 面板里选了一个类型：已落库就补类型，没落库就带着类型落库 */
  async function handlePick(mode: QuestionMode) {
    const { id, tS } = panel;
    if (id) {
      const res = await fetch(`/api/interrupts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionMode: mode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "没记下来，请重试");
      setPoints((prev) =>
        prev.map((p) => (p.id === id ? { ...p, question_mode: mode } : p)),
      );
    } else {
      const saved = await postInterrupt(tS, mode);
      setPoints((prev) => [...prev, saved]);
    }
    closePanel();
  }

  /** 不选类型，只记下这一刻 */
  async function handleJustCapture() {
    const saved = await postInterrupt(panel.tS, null);
    setPoints((prev) => [...prev, saved]);
    closePanel();
  }

  const handleSeek = useCallback((t: number) => {
    handleRef.current?.seekTo(t);
    // 立刻把"现在在哪"改过来，别等下一次 250ms 轮询。
    // 否则连点两下点点条的「下一个」会卡在原地 —— 第二下读到的还是旧位置。
    currentTimeRef.current = t;
    if (clockRef.current) clockRef.current.textContent = mmss(t);
  }, []);

  /** 字幕层自己按 250ms 来取时间。给它 ref 的读法，而不是把秒数灌进 state ——
      灌进去就是每秒 4 次整页重渲染，M0.5 栽过的那个坑 */
  const getCurrentTime = useCallback(() => currentTimeRef.current, []);

  /** 1c-fix / D19：删掉一个误点的捕获点。先从条上撤下来，失败再放回去 */
  const handleDelete = useCallback(async (id: string) => {
    const snapshot = pointsRef.current;
    setPoints((prev) => prev.filter((p) => p.id !== id));
    try {
      const res = await fetch(`/api/interrupts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "没删掉，请重试");
      }
    } catch (e) {
      setPoints(snapshot); // 回滚到删之前，别让点凭空消失
      throw e;
    }
  }, []);

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

      // 时长只 setState 一次 —— 点点条要用它算百分比
      if (!durationKnownRef.current && duration > 0) {
        durationKnownRef.current = true;
        setDurationS(duration);
      }

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

  if (!shell) {
    return (
      <div className="rounded-2xl border border-ink-700 p-5 text-sm text-ink-300">
        这类内容（{source.kind}）的播放器还没做。
      </div>
    );
  }

  const { Player } = shell;

  return (
    <div className="flex flex-col gap-3">
      {/* D18：画面越大越好 —— 手机上让播放器顶掉页面左右内边距，整整宽出 40px。
          sm 以上回到圆角卡片（桌面宽度富余，全出血反而失衡） */}
      <div className="-mx-5 sm:mx-0">
        <Player
          source={source}
          onReady={handleReady}
          onPlayingChange={handlePlayingChange}
          onPause={handlePause}
        />
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-ink-700 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${playing ? "bg-teal-400" : "bg-ink-500"}`}
            aria-hidden
          />
          <span className="text-sm text-ink-300">{playing ? "播放中" : "已暂停"}</span>
          <span className="text-xs text-ink-500">
            · {source.transcript_status === "ready" ? "字幕就绪" : "字幕待生成"}
          </span>
        </div>
        <p className="ui-mono text-sm text-ink-100" aria-label="播放位置">
          <span ref={clockRef}>{source.last_position_s ? mmss(source.last_position_s) : "00:00"}</span>
          <span className="text-ink-500"> / </span>
          <span ref={totalRef} className="text-ink-500">
            {source.duration_s ? mmss(source.duration_s) : "--:--"}
          </span>
        </p>
      </div>

      <DotBar
        points={points}
        durationS={durationS}
        getCurrentTime={getCurrentTime}
        onSeek={handleSeek}
        onDelete={handleDelete}
      />

      {/* D4：字幕可开关、字号可调、行宽自适应 —— 视频与播客共用同一层 */}
      <CaptionLayer
        sourceId={source.id}
        transcript={source.transcript}
        getCurrentTime={getCurrentTime}
        onSeek={handleSeek}
      />

      {/* 悬浮捕获球（position:fixed，挂在树里即可，位置与页面布局无关）。
          轻点 = 记下这一刻并开面板；长按聆听的下游（真实语音）是 M3。
          state 先写死 ready，真状态源是 M2 的 transcript_status。 */}
      <CaptureOrb
        state="ready"
        onTap={captureNow}
        onLongPressStart={() => {
          // M3：长按 → 接 Live 语音提问。现在只有球自己的视觉 + 占位字幕
        }}
        onLongPressEnd={() => {
          // M3：松手结束语音轮
        }}
      />

      <InterruptPanel
        open={panel.open}
        tS={panel.tS}
        captured={panel.id !== null}
        onPick={handlePick}
        onJustCapture={handleJustCapture}
        onClose={closePanel}
      />
    </div>
  );
}

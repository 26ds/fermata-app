"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { activeSegmentIndex } from "@/lib/captions";
import { CaptionLayer } from "@/components/caption-layer";
import { CaptureOrb } from "@/components/capture-orb";
import { DotBar, type InterruptPoint } from "@/components/dot-bar";
import { InterruptPanel } from "@/components/interrupt-panel";
import { playerFor } from "@/lib/sources/players";
import type { PlayerHandle } from "@/lib/sources/types";
import { mmss } from "@/lib/time";
import type { QuestionMode, SourceRow, TranscriptSegment, TranscriptStatus } from "@/lib/types";

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
  // M2a：字幕不再是一份死数据，它会边转边长 —— 收进 state 才能实时往下传
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(source.transcript);
  const [status, setStatus] = useState<TranscriptStatus>(source.transcript_status);
  const [gen, setGen] = useState<{
    running: boolean;
    coveredS: number | null;
    error: string;
  }>({ running: false, coveredS: null, error: "" });
  const runningRef = useRef(false);
  // 字幕本体。热路径（250ms 那一轮）要查"这一刻有没有字幕"，所以走 ref
  const segmentsRef = useRef<TranscriptSegment[]>(source.transcript ?? []);
  const orbReadyRef = useRef(false);
  const [orbReady, setOrbReady] = useState(false);
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

  /**
   * M2a：把字幕转出来。服务端回的是 **NDJSON 流** —— 一行一个事件，
   * 转出一块推一块，所以字幕是"长出来"的，不是等到最后一次性砸下来。
   *
   * 落库在服务端那边做，这里只负责显示：中途断了也不丢，重进页面还在。
   */
  const runTranscription = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setGen({ running: true, coveredS: null, error: "" });

    let complete = false;
    let note = "";
    try {
      const res = await fetch("/api/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          // 播放器知道的时长比库里准（YouTube 的 oEmbed 给不了时长）
          durationS: handleRef.current?.getDuration() || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "字幕没生成出来，稍后再试");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // NDJSON：按行切，最后一截可能是半行，留给下一轮
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;

          let event: {
            type?: string;
            segments?: TranscriptSegment[];
            coveredS?: number;
            complete?: boolean;
            message?: string;
            note?: string | null;
          };
          try {
            event = JSON.parse(raw);
          } catch {
            continue; // 半行或杂音，跳过就是
          }

          if (event.type === "partial" && event.segments) {
            setTranscript(event.segments);
            segmentsRef.current = event.segments;
            setGen((g) => ({ ...g, coveredS: event.coveredS ?? g.coveredS }));
            setStatus("partial");
          } else if (event.type === "done") {
            if (event.segments) {
              setTranscript(event.segments);
              segmentsRef.current = event.segments;
            }
            complete = Boolean(event.complete);
            setStatus(complete ? "ready" : "partial");
            // 半截停下来是有原因的，别让用户对着不动的字幕自己猜
            if (!complete && event.note) note = event.note;
          } else if (event.type === "error") {
            setStatus("failed");
            throw new Error(event.message ?? "字幕没生成出来");
          }
        }
      }
      setGen({ running: false, coveredS: null, error: note });
    } catch (e) {
      setGen({
        running: false,
        coveredS: null,
        error: e instanceof Error ? e.message : "字幕没生成出来，稍后再试",
      });
    } finally {
      runningRef.current = false;
    }
    return complete;
  }, [source.id]);

  useEffect(() => {
    // 没转过的（pending）和转了一半的（partial）都自动接着干 ——
    // 创始人真机撞到的就是这个：转到一半退出页面，再进来它就那么僵着，
    // 得手动去点"继续生成"。**没转完的东西不该等人来催。**
    // 失败的（failed）仍然不自动重来：私享视频那类是永久性失败，
    // 每开一次页面重试一次只是白烧额度再报同一句错。
    if (source.transcript_status !== "pending" && source.transcript_status !== "partial") return;

    let cancelled = false;
    let tries = 0;

    const tick = async () => {
      if (cancelled) return;
      // 等播放器把真实时长报上来（最多等 5 秒）——
      // 时长不知道就只能盲切，知道了才切得准、也才知道什么时候算转完
      if (!durationKnownRef.current && tries++ < 10) {
        window.setTimeout(tick, 500);
        return;
      }
      // 一次最多接力 3 轮（服务端每轮有 240 秒软预算）。再长的内容
      // 交给用户按「继续生成」—— 每一按都是真金白银，不该由代码替他连按
      for (let round = 0; round < 3 && !cancelled; round++) {
        const done = await runTranscription();
        if (done !== false) break;
      }
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [source.transcript_status, runTranscription]);

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

      // 球色（D5）：**这一刻有没有字幕**，而不是"整片转完没有"。
      // 只看 transcript_status 不诚实 —— 字幕才转到第 10 分钟、人已经拖到
      // 第 40 分钟，那儿根本没字幕可用，球不该是青的。
      // 也不能只看"转到第几秒"：并行之后各片乱序回来，中间可能是空的。
      // 只有真去查一下这一刻落没落在某一句上，才算数。
      const segs = segmentsRef.current;
      const i = activeSegmentIndex(segs, t);
      const ready = i >= 0 && segs[i].end >= t - 2;
      if (ready !== orbReadyRef.current) {
        orbReadyRef.current = ready;
        setOrbReady(ready);
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
            ·{" "}
            {status === "ready"
              ? "字幕就绪"
              : gen.running
                ? "字幕生成中"
                : status === "failed"
                  ? "字幕没生成出来"
                  : status === "partial"
                    ? "字幕生成了一半"
                    : "字幕待生成"}
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
        transcript={transcript}
        getCurrentTime={getCurrentTime}
        onSeek={handleSeek}
        generation={{
          running: gen.running,
          coveredS: gen.coveredS,
          totalS: durationS || source.duration_s,
          error: gen.error,
          resumable: status === "partial",
          onRun: () => void runTranscription(),
        }}
      />

      {/* 悬浮捕获球（position:fixed，挂在树里即可，位置与页面布局无关）。
          轻点 = 记下这一刻并开面板；长按聆听的下游（真实语音）是 M3。
          M2a：球色接上真状态 —— 灰=这一刻还没字幕，青=这一刻有字幕（D5 的双态色）。
          判据是"盖没盖住当前播放位置"，不是"整片转完没有"。 */}
      <CaptureOrb
        state={orbReady ? "ready" : "pending"}
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

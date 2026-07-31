"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { activeSegmentIndex } from "@/lib/captions";
import { CaptionLayer } from "@/components/caption-layer";
import { CaptureOrb } from "@/components/capture-orb";
import { DotBar } from "@/components/dot-bar";
import { ImmersiveChat } from "@/components/immersive-chat";
import { InterruptPanel } from "@/components/interrupt-panel";
import type { PausePoint } from "@/components/pause-list";
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
  startAtS,
  startInChat,
}: {
  source: SourceRow;
  interrupts: PausePoint[];
  /**
   * M3.6：`/watch/[id]?t=<秒>`。从「历史与知识库」里点一个暂停点过来的 ——
   * 那一页没有播放器，只能真跳页，所以落地时要自己把播放头放到那一秒。
   */
  startAtS?: number | null;
  /** M3.6：`?chat=1`。从回看页点「和这条内容聊过 N 轮」过来的，落地直接进沉浸层 */
  startInChat?: boolean;
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
  // 沉浸态也走 ref：进入时 pause() 会触发 onPause，必须在那之前就置位，
  // 否则 handlePause 会把短问答面板弹到沉浸层底下（同步判断，state 太慢）
  const immersiveRef = useRef(Boolean(startInChat));
  // ?t= 只认一次：跳过去之后就作废，别在播放器每次重建时把人拽回原点
  const startAtRef = useRef(startAtS ?? null);
  // 观看历史只写一次（每次进这一页），别把「看过 N 次」写成"播放键按了几下"
  const watchedSentRef = useRef(false);

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
  const [points, setPoints] = useState<PausePoint[]>(interrupts);
  const [panel, setPanel] = useState<{
    open: boolean;
    tS: number;
    id: string | null;
    captured: boolean;
  }>({
    open: false,
    tS: 0,
    id: null,
    captured: false,
  });
  // 这条打断点落库的 promise —— handleAsk 直接 await，避免"刚开面板就问"时重复落库
  const panelIdRef = useRef<Promise<string | null> | null>(null);
  const panelTSRef = useRef(0);
  // M3 打断问答：流式答案状态
  const [ask, setAsk] = useState<{ asking: boolean; answer: string; error: string }>({
    asking: false,
    answer: "",
    error: "",
  });
  // M3 Phase-2：长问答沉浸聊天是观看页上的一层浮层（状态开关，不是新路由）——
  // 播放器实例永不卸载，退出不重载、不跳回开头（WORKORDER D33 / design §99）。
  const [immersive, setImmersive] = useState(Boolean(startInChat));
  // 量「视频底缘」给沉浸磨砂层用（磨砂从这条线往下铺，不碰视频本体）
  const videoWrapRef = useRef<HTMLDivElement>(null);

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
    // M3.6：带着 ?t= 进来的，就绪的第一件事就是把播放头放到那一秒。
    // 不自动播放 —— 跳到位置和"替他按播放"是两回事（D18 那条克制的延长线）。
    const t = startAtRef.current;
    if (t != null && t > 0) {
      startAtRef.current = null;
      handle.seekTo(t);
      currentTimeRef.current = t;
      if (clockRef.current) clockRef.current.textContent = mmss(t);
    }
  }, []);

  /**
   * M3.6：记下"这条内容什么时候被看的"（迁移 0007）。
   * 在这之前库里只有 last_position_s（看到第几秒），**没有任何字段记得什么时候看的** ——
   * 「历史与知识库」按观看日期分组要的就是它。
   *
   * 时机：**第一次真正播放**。不是打开页面就写 —— 点进来看了一眼标题就退，那不叫看过。
   * 计次：同一天再看不 +1（拖两下进度条就写成"看过 40 次"是荒唐的）。
   * 判据在客户端算，因为"今天"是**看的人所在时区**的今天，服务端在 UTC 上算不准。
   */
  const markWatched = useCallback(() => {
    if (watchedSentRef.current) return;
    watchedSentRef.current = true;
    const lastDay = source.last_watched_at
      ? new Date(source.last_watched_at).setHours(0, 0, 0, 0)
      : null;
    const newDay = lastDay == null || lastDay !== new Date().setHours(0, 0, 0, 0);
    void fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watched: true, countsAsNewWatch: newDay }),
    }).catch(() => {
      // 迁移 0007 还没跑、或网络抽风：下一次播放再试。写不上不影响看视频
      watchedSentRef.current = false;
    });
  }, [source.id, source.last_watched_at]);

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
      // 真播起来了才算"看过这条"（M3.6 观看历史）
      if (next) markWatched();
      // 暂停的那一刻是最该记住的位置
      if (!next) savePosition();
    },
    [savePosition, markWatched],
  );

  const postInterrupt = useCallback(
    async (tS: number, mode: QuestionMode | null): Promise<PausePoint> => {
      const res = await fetch("/api/interrupts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, tS, questionMode: mode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "没记下来，请重试");
      return body as PausePoint;
    },
    [source.id],
  );

  // ── 打断面板的开关 ──
  // capture=true（点球）：开面板同时把这一刻记下来（乐观先画点，落库回来换真 id）。
  // capture=false（暂停）：先开面板不落库 —— 用户可能只是停下想想，真问了再记（handleAsk）。
  const openPanel = useCallback(
    (tS: number, capture: boolean) => {
      // 同步置位：紧接着的 pause 回调靠它判断"这是我们自己按停的"
      panelOpenRef.current = true;
      panelTSRef.current = tS;
      if (playingRef.current) {
        resumeOnCloseRef.current = true;
        handleRef.current?.pause();
      } else {
        resumeOnCloseRef.current = false;
      }
      setAsk({ asking: false, answer: "", error: "" }); // 新一轮问答，清掉上次答案
      setPanel({ open: true, tS, id: null, captured: capture });

      if (capture) {
        const tempId = `temp-${Date.now()}`;
        setPoints((prev) => [
          ...prev,
          { id: tempId, t_s: tS, question_mode: null, question: null, ai_answer: null },
        ]);
        // 落库做成 promise，handleAsk 直接 await —— 避免"点球刚开面板就问"重复落库
        panelIdRef.current = postInterrupt(tS, null)
          .then((saved) => {
            setPoints((prev) => prev.map((p) => (p.id === tempId ? saved : p)));
            setPanel((p) => (p.open && p.id === null ? { ...p, id: saved.id } : p));
            return saved.id;
          })
          .catch(() => {
            setPoints((prev) => prev.filter((p) => p.id !== tempId)); // 没存上撤掉假点
            return null;
          });
      } else {
        panelIdRef.current = null; // 还没落库，等真问了再记
      }
    },
    [postInterrupt],
  );

  const closePanel = useCallback(() => {
    panelOpenRef.current = false;
    setPanel((p) => ({ ...p, open: false }));
    if (resumeOnCloseRef.current) {
      resumeOnCloseRef.current = false;
      handleRef.current?.play();
    }
  }, []);

  // ── 长问答沉浸聊天 进/出（design §B/C/E） ──
  // 进入：视频先冻结（暂停）；关掉可能开着的短问答面板但**不**触发它的续播。
  // 顺序要紧：immersiveRef 必须在 pause() 之前置位（pause 会触发 onPause→handlePause）。
  const enterImmersive = useCallback(() => {
    immersiveRef.current = true;
    panelOpenRef.current = false;
    resumeOnCloseRef.current = false;
    setPanel((p) => ({ ...p, open: false }));
    handleRef.current?.pause();
    setImmersive(true);
  }, []);
  // 退出：不自动播放，保留进入时的暂停状态（design §E.4）。退出 compact 在沉浸层卸载时跑。
  const exitImmersive = useCallback(() => {
    immersiveRef.current = false;
    setImmersive(false);
  }, []);

  /** 用户真的按了暂停（缓冲/播放结束不算，见 PlayerProps.onPause） */
  const handlePause = useCallback(() => {
    if (panelOpenRef.current || immersiveRef.current) return; // 面板已开 / 沉浸态：不弹短问答面板
    openPanel(currentTimeRef.current, false);
  }, [openPanel]);

  /** 轻点悬浮球 = 记下这一刻并开面板 */
  const captureNow = useCallback(() => {
    openPanel(currentTimeRef.current, true);
  }, [openPanel]);

  /** 问一句：确保这刻已落库（拿到 interruptId）→ 流式取 /api/ask，边收边显示 */
  const handleAsk = useCallback(
    async (question: string) => {
      setAsk({ asking: true, answer: "", error: "" });
      try {
        // 点球开的面板已经在落库（await 那个 promise）；暂停开的还没落库，这会儿才记（标 free）
        let idPromise = panelIdRef.current;
        if (!idPromise) {
          idPromise = postInterrupt(panelTSRef.current, "free")
            .then((saved) => {
              setPoints((prev) => [...prev, saved]);
              setPanel((p) => (p.open && p.id === null ? { ...p, id: saved.id, captured: true } : p));
              return saved.id;
            })
            .catch(() => null);
          panelIdRef.current = idPromise;
        }
        const id = await idPromise;
        if (!id) throw new Error("没记下这一刻，稍后再问一次");

        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ interruptId: id, question }),
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? "没答出来，稍后再试");
        }

        // NDJSON：chunk 逐块拼、done 收尾、error 报错
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let streamErr = "";
        // 收全的答案。除了上屏，M3.5 还要拿它就地更新那个暂停点 —— 不然刚问完的这一条
        // 在回看列表里还写着「只是停了一下」，得刷新页面才对得上
        let fullAnswer = "";
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
              fullAnswer += piece;
              setAsk((a) => ({ ...a, answer: a.answer + piece }));
            } else if (ev.type === "done") {
              const full = ev.answer;
              if (full) fullAnswer = full;
              setAsk((a) => ({ asking: false, answer: full ?? a.answer, error: "" }));
            } else if (ev.type === "error") {
              streamErr = ev.message ?? "没答出来，稍后再试";
            }
          }
        }
        if (streamErr) {
          setAsk({ asking: false, answer: "", error: streamErr });
        } else {
          setAsk((a) => (a.asking ? { ...a, asking: false } : a));
          // 服务端答完整了才落库（/api/ask），这里跟着把本地那一行补齐，口径保持一致
          if (fullAnswer.trim()) {
            setPoints((prev) =>
              prev.map((p) =>
                p.id === id
                  ? {
                      ...p,
                      question,
                      ai_answer: fullAnswer,
                      question_mode: p.question_mode ?? "free",
                    }
                  : p,
              ),
            );
          }
        }
      } catch (e) {
        setAsk({
          asking: false,
          answer: "",
          error: e instanceof Error ? e.message : "没答出来，稍后再试",
        });
      }
    },
    [postInterrupt],
  );

  /** 不问，只把这一刻记下来（暂停触发、还没落库时的入口） */
  async function handleJustCapture() {
    const saved = await postInterrupt(panelTSRef.current, null);
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
  const runTranscription = useCallback(async (cacheOnly = false) => {
    if (runningRef.current) return;
    runningRef.current = true;
    // 只查缓存那次是"静默"的：命中就让字幕自己冒出来，没命中什么都不显示，
    // 别闪一下"生成中"再缩回去。真要花钱转时才亮出进度。
    if (!cacheOnly) setGen({ running: true, coveredS: null, error: "" });

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
          cacheOnly: cacheOnly || undefined,
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
          // event.type === "miss"：缓存没命中。什么都不做 —— 状态留 pending，
          // 让 YouTube 的「生成字幕」按钮候着，等用户真要花钱时再点。
        }
      }
      if (!cacheOnly) setGen({ running: false, coveredS: null, error: note });
    } catch (e) {
      // 只查缓存那次失败就默默算了（多半是迁移还没跑），别拿红字吓用户
      if (!cacheOnly) {
        setGen({
          running: false,
          coveredS: null,
          error: e instanceof Error ? e.message : "字幕没生成出来，稍后再试",
        });
      }
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

      // YouTube 从没转过（pending）：**只免费查一次缓存**（D31）——
      // 别人转过这支就直接白拿、零点击零等待；没人转过就此打住，
      // 等用户按「生成字幕」再花钱走 Gemini。绝不打开就自动烧钱。
      // 缓存检查不需要时长，立刻打。
      if (source.kind === "youtube" && source.transcript_status === "pending") {
        await runTranscription(true);
        return;
      }

      // 其余（YouTube 转了一半要续 / 播客自动转）：这些是真要转的，
      // 先等播放器报真实时长（最多等 5 秒）—— 不知道时长就切不准、也不知何时算转完。
      if (!durationKnownRef.current && tries++ < 10) {
        window.setTimeout(tick, 500);
        return;
      }
      // 一次最多接力 3 轮（服务端每轮有 240 秒软预算）。再长的内容
      // 交给用户按「继续生成」—— 每一按都是真金白银，不该由代码替他连按
      for (let round = 0; round < 3 && !cancelled; round++) {
        const done = await runTranscription(false);
        if (done !== false) break;
      }
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [source.transcript_status, source.kind, runTranscription]);

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
      <div ref={videoWrapRef} className="-mx-5 sm:mx-0">
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

      {/* M3.6：暂停点回看列表**已经从这里搬走**（D37/D38）——
          创始人真机看过后的原话是"就不应该出现在看视频的界面"。
          它现在的家是 `/library/[id]` 的 tab1，并且在那里按天分了堆。
          这一页留下的只有横着的点点条：看的时候要的是位置感，不是一张清单。 */}

      {/* D4：字幕可开关、字号可调、行宽自适应 —— 视频与播客共用同一层 */}
      <CaptionLayer
        sourceId={source.id}
        transcript={transcript}
        kind={source.kind}
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
        immersive={immersive}
        onTap={captureNow}
        onLongPress={immersive ? exitImmersive : enterImmersive}
      />

      <InterruptPanel
        open={panel.open}
        tS={panel.tS}
        captured={panel.captured}
        asking={ask.asking}
        answer={ask.answer}
        askError={ask.error}
        onAsk={handleAsk}
        onJustCapture={handleJustCapture}
        onEnterImmersive={enterImmersive}
        onClose={closePanel}
      />

      {immersive && (
        <ImmersiveChat
          sourceId={source.id}
          videoRef={videoWrapRef}
          getCurrentTime={getCurrentTime}
          pauseVideo={() => handleRef.current?.pause()}
          onExit={exitImmersive}
        />
      )}
    </div>
  );
}

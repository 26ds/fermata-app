"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeSegmentIndex, segmentsInWindow } from "@/lib/captions";
import { CaptionLayer } from "@/components/caption-layer";
import { CaptureOrb } from "@/components/capture-orb";
import { DotBar } from "@/components/dot-bar";
import { ImmersiveChat } from "@/components/immersive-chat";
import { InterruptPanel, type PanelLine } from "@/components/interrupt-panel";
import type { PausePoint } from "@/components/pause-list";
import { PlayerControls } from "@/components/player-controls";
import { DEFAULT_LANG_PREFS, type LangPrefs } from "@/lib/lang";
import {
  isPhraseScan,
  resolvePhrases,
  scanDrift,
  type PhraseItem,
  type PhraseScan,
} from "@/lib/phrases/types";
import { DEFAULT_PLAY_PREFS, type PlayPrefs } from "@/lib/play-prefs";
import { putSettings } from "@/lib/settings-client";
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
  prefs = DEFAULT_LANG_PREFS,
  play = DEFAULT_PLAY_PREFS,
  autoScan: autoScanInitial = false,
  savedAtoms = [],
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
  /** M3.7 / D42：三个语言（母语 / 目标语言 / 译文语言），服务端读出来传下来 */
  prefs?: LangPrefs;
  /** 倍速 + 一跳几秒。服务端首屏就给，省得进来先显示 1× 再"跳"成 1.5× */
  play?: PlayPrefs;
  /**
   * AI 自动标词开着吗（D45）。**默认关** —— 手动选词才是主路径，
   * 一个降级成"顺带提示"的功能不该还在背后自己花钱。开关在暂停面板里那一行。
   */
  autoScan?: boolean;
  /** M3.7：这条内容里已经收进词库的词组（决定 ✓ 是实心还是空心） */
  savedAtoms?: { id: string; term: string }[];
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
  /**
   * 这一次进来，画面**真的动过**吗（收到过一次 PLAYING）。
   * 只用来拦 ±N 秒 —— 从没播过的播放器一 seek 就变黑（见 seekBy 上的说明）。
   * 暂停之后仍然是 true：播过一帧之后再跳，画面是好的（复现验过）。
   */
  const [started, setStarted] = useState(false);
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

  // === 倍速 + 一跳几秒（2026-08-01 真机反馈第二轮） ===
  // rate 这个 state 是**播放器实测值的镜子**，不是"我们请求的值"：YouTube 有权不认某个倍速，
  // 而显示一个按不出来的数比不显示还糟。rateRef 才记着"用户选的"，播放器每次就绪都按它重设一遍
  // （换片 / 从沉浸态回来 / iOS 回收后重建，倍速都会被打回 1）。
  const [rate, setRate] = useState(play.rate);
  const [skipStep, setSkipStep] = useState(play.skipStep);
  const rateRef = useRef(play.rate);
  /** 牌子上正显示的那个数（给 250ms 那轮比对用，走 ref 才不会读到过期闭包） */
  const shownRateRef = useRef(play.rate);

  // === M3.7 词库（D40 + D42） ===
  // 整片扫出来的词组。首屏直接吃服务端那份（`sources.phrases`）—— 扫过的片子
  // **一进来高亮就在**，不用等任何请求（验收⑤"重看不再花钱"的可见部分）。
  const [scan, setScan] = useState<PhraseScan | null>(
    isPhraseScan(source.phrases) ? source.phrases : null,
  );
  /**
   * 扫描这件事**必须能被看见**（M3.7 真机第一轮的教训）。
   * 原来失败一律静默，于是"扫描中闪一下然后什么都没有"可能是四种完全不同的原因 ——
   * 字幕没转完 / 上次崩了留下并发锁 / 真的一个词都没标出来 / 报错 ——
   * 而用户和我都无从分辨。**说不清楚的失败等于没做。**
   */
  const [scanState, setScanState] = useState<{
    status: "idle" | "off" | "scanning" | "ready" | "empty" | "not-ready" | "running" | "failed";
    count: number;
  }>({
    // D45：关着的时候也要**说出来**。默默什么都不做，和"扫了但什么都没标出来"
    // 在屏幕上长得一模一样 —— 那正是 D44 要根除的那种沉默。
    status: autoScanInitial ? "idle" : "off",
    count: isPhraseScan(source.phrases) ? source.phrases.items.length : 0,
  });
  /** 自动标词的开关（D45，默认关）。ref 给 openPanel 用 —— 那里读 state 会读到旧闭包 */
  const [autoScan, setAutoScan] = useState(autoScanInitial);
  const autoScanRef = useRef(autoScanInitial);
  /** D42：内容不是他母语、又没问过 —— 有值时面板上弹那一句问询。答完即定 */
  const [needTargetLang, setNeedTargetLang] = useState("");
  /** 已收进词库的：词组原文 → atom id（取消勾选要用 id） */
  const [savedMap, setSavedMap] = useState<Map<string, string>>(
    () => new Map(savedAtoms.map((a) => [a.term, a.id])),
  );
  const scanTriedRef = useRef(false);
  const scanRunningRef = useRef(false);
  const savedRef = useRef(savedMap);
  useEffect(() => {
    savedRef.current = savedMap;
  }, [savedMap]);
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
    // 播放器每次就绪都把用户选的倍速重设一遍 —— 它自己不记，默认永远是 1
    if (rateRef.current !== 1) handle.setRate(rateRef.current);
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
      // 这条内容**这一次进来有没有真的播出过画面**。±N 秒要靠它把自己拦住 —— 见 seekBy
      if (next && !started) setStarted(true);
      setPlaying(next);
      // 真播起来了才算"看过这条"（M3.6 观看历史）
      if (next) markWatched();
      // 暂停的那一刻是最该记住的位置
      if (!next) savePosition();
    },
    [savePosition, markWatched, started],
  );

  /**
   * M3.7 / D40 —— **懒触发**整片扫词组：第一次在这片子里暂停时后台跑一次，
   * 不看的片子一分钱不花。服务端已经扫过就原样返回（不重复计费）。
   *
   * 全程静默失败：扫不出来只是没有高亮，**面板照常能问、视频照常能看** ——
   * 词库这一片不许把观看页拖下水。
   */
  const ensurePhrases = useCallback(
    async (force = false) => {
      if (scanRunningRef.current) return;
      if (scanTriedRef.current && !force) return;
      scanTriedRef.current = true;
      scanRunningRef.current = true;
      setScanState((s) => ({ ...s, status: "scanning" }));
      let outcome: (typeof scanState)["status"] = "failed";
      let count = 0;
      try {
        // 长内容一轮扫不完（服务端有 150 秒软预算），最多接力 3 轮
        for (let round = 0; round < 3; round++) {
          const res = await fetch("/api/phrases", {
            method: "POST",
            headers: { "content-type": "application/json" },
            // force 只在用户按「再扫一次」时为真 —— 破锁 + 从头重扫，是花钱的动作
            body: JSON.stringify({ sourceId: source.id, force: force || undefined }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) break; // outcome 留在 failed
          if (body.status === "need-target") {
            setNeedTargetLang(String(body.contentLang ?? ""));
            outcome = "idle"; // 等他答完那一句再扫，这不算失败
            break;
          }
          if (isPhraseScan(body.phrases)) {
            setScan(body.phrases);
            count = body.phrases.items.length;
          }
          if (body.status === "not-ready" || body.status === "running") {
            outcome = body.status;
            break;
          }
          if (body.status !== "partial") {
            // 扫完了。**一个都没标出来要单独说** —— 它和"没扫"长得一样，但原因完全不同
            outcome = count > 0 ? "ready" : "empty";
            break;
          }
          // partial：预算用完了，下一轮接着扫
          outcome = count > 0 ? "ready" : "empty";
        }
      } catch {
        // 网络抽风：outcome 留在 failed，界面会给一个「再扫一次」
      } finally {
        scanRunningRef.current = false;
        setScanState({ status: outcome, count });
      }
    },
    [source.id],
  );

  /**
   * 这份扫描是不是按**旧的语言设置**扫的（M3.9，创始人 2026-08-02 反馈）。
   *
   * 他把母语改回简体中文之后，**找不到任何重扫的入口** —— 「再扫一次」只在
   * empty / failed / running 时出现，而他那份是 `ready`。于是一份按错的语言扫出来的
   * 结果就永远钉死在那儿了。现在语言对不上时也给按钮，并**说清楚为什么给**。
   */
  const drift = scan ? scanDrift(scan, prefs, source.content_lang) : "";

  /**
   * 自动标词的开 / 关（D45，创始人 2026-08-02：「做一个按钮，默认关闭，点击后打开就开始运行」）。
   *
   * **开** = 存进偏好 + **当场就把这一片扫了**（他要的就是"点开就跑"，不是"下次进来才跑"）。
   * **关** = 只是不再自动跑；**已经标出来的一个都不删** —— 存在 `sources.phrases` 里的照旧高亮、
   * 照旧能收。花过的钱不该因为关了个开关就白花。
   */
  const toggleAutoScan = useCallback(() => {
    const next = !autoScanRef.current;
    autoScanRef.current = next;
    setAutoScan(next);
    void putSettings({ autoScan: next });
    if (next) {
      scanTriedRef.current = false;
      void ensurePhrases();
    } else {
      // 关了就把那一行退回"关着"，别让它继续显示上一次的结局
      setScanState((s) => ({ ...s, status: "off" }));
    }
  }, [ensurePhrases]);

  /** 用户按「再扫一次」：破锁 + 从头重扫。**花钱的动作，只由人触发** */
  const rescan = useCallback(() => {
    scanTriedRef.current = false;
    void ensurePhrases(true);
  }, [ensurePhrases]);

  /** D42 那一句问询的答案。答完立刻存，并接着把这条内容按正确的模式扫一遍 */
  const answerTarget = useCallback(
    (learn: boolean) => {
      const value = learn ? needTargetLang : ""; // "" = 问过了、不学语言（和"没问过"分得开）
      setNeedTargetLang("");
      void putSettings({ targetLang: value }).then(() => {
        scanTriedRef.current = false;
        void ensurePhrases(true);
      });
    },
    [needTargetLang, ensurePhrases],
  );

  /**
   * 勾 / 取消勾一个词组。乐观更新 —— 打勾要立刻有反应，落库慢一拍不该让人等。
   * 失败就回滚，别让一个假的实心勾骗人说"已经收进去了"。
   */
  const toggleTerm = useCallback(
    async (phrase: PhraseItem) => {
      const existingId = savedRef.current.get(phrase.text);
      if (existingId) {
        setSavedMap((prev) => {
          const next = new Map(prev);
          next.delete(phrase.text);
          return next;
        });
        try {
          const res = await fetch(`/api/atoms/${existingId}`, { method: "DELETE" });
          if (!res.ok) throw new Error("delete failed");
        } catch {
          setSavedMap((prev) => new Map(prev).set(phrase.text, existingId));
        }
        return;
      }

      const temp = `temp-${Date.now()}`;
      setSavedMap((prev) => new Map(prev).set(phrase.text, temp));
      try {
        const res = await fetch("/api/atoms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceId: source.id,
            term: phrase.text,
            gloss: phrase.gloss,
            // 它出现的那句原话 —— 复习时光看一个孤零零的词组是想不起来的
            contextQuote: segmentsRef.current[phrase.i]?.text ?? "",
            tS: phrase.t,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.atom?.id) throw new Error("save failed");
        setSavedMap((prev) => new Map(prev).set(phrase.text, String(body.atom.id)));
      } catch {
        setSavedMap((prev) => {
          const next = new Map(prev);
          if (next.get(phrase.text) === temp) next.delete(phrase.text);
          return next;
        });
      }
    },
    [source.id],
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
      // D40 懒触发：**第一次在这片子里停下来**才去扫词组。打开页面就扫等于替他花钱。
      // D45（2026-08-02）：而且**默认根本不扫** —— 自动标词降级成一个默认关着的开关，
      // 他自己按下「开」才跑。一个已经不是主路径的功能，不该还在背后自己花钱。
      if (autoScanRef.current) void ensurePhrases();

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
    [postInterrupt, ensurePhrases],
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

  /**
   * ±N 秒。夹在 [0, 时长) 里 —— 往前跳过头会让 YouTube 直接判"播完了"。
   *
   * ⚠️ **视频还没播过就不许跳**（创始人 2026-08-02 报「视频播放都是黑色的」，已复现）：
   * `seekTo()` 打在一个"已载入但一次都没播过"的 YouTube 播放器上，会**把封面图掀掉**，
   * 而它又没法在没有 iframe 内手势的情况下自己播起来 —— 结果就是**一整块黑的**，
   * 而且回不去（封面图不会再回来）。复现边界很干净：正在播的时候跳，一切正常；
   * 从没播过的时候跳，必黑。
   * 所以这里直接拦住，按钮那边同步变灰并写明"先播起来"，**不做静默的空动作**（D44）。
   */
  const seekBy = useCallback(
    (deltaS: number) => {
      const handle = handleRef.current;
      if (!handle) return;
      if (!started && source.kind === "youtube") return;
      const duration = handle.getDuration();
      const raw = (handle.getCurrentTime() || currentTimeRef.current) + deltaS;
      const ceiling = duration > 0 ? Math.max(0, duration - 0.5) : raw;
      handleSeek(Math.max(0, Math.min(ceiling, raw)));
    },
    [handleSeek, started, source.kind],
  );

  /** 换倍速：先落到播放器，再记进偏好（换台设备也是这个速度） */
  const changeRate = useCallback((next: number) => {
    rateRef.current = next;
    shownRateRef.current = next;
    setRate(next);
    handleRef.current?.setRate(next);
    void putSettings({ playRate: next });
  }, []);

  const changeStep = useCallback((next: number) => {
    setSkipStep(next);
    void putSettings({ skipStep: next });
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

      // 倍速牌子照实说：用户可能在 YouTube 自带的齿轮菜单里改了速度，
      // 我们这块牌子就得跟着改口 —— 写着 1× 却在 1.5× 播，是骗人。
      // **只镜像、不回存偏好**：播放器自己把倍速打回 1 的情况（换片 / 重建）很常见，
      // 那不是用户的意思，存下去等于把他选的速度悄悄抹了。要恢复，点一下就好。
      const actualRate = handle.getRate();
      if (actualRate > 0 && Math.abs(actualRate - shownRateRef.current) > 0.01) {
        shownRateRef.current = actualRate;
        setRate(actualRate);
      }

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

  // M3.7：把扫描结果对齐回**当前**字幕。字幕会变（转到一半会继续长、还能重新粘一份），
  // 下标错位就会把高亮标到别的句子上 —— `resolvePhrases` 逐条校验，对不上的宁可不标。
  // useMemo：字幕层是 250ms 的热路径，这个绝不能每帧重算。
  const highlights = useMemo(() => resolvePhrases(scan, transcript ?? []), [scan, transcript]);
  const savedTerms = useMemo(() => new Set(savedMap.keys()), [savedMap]);

  // D39：面板里那两秒（`[t−2, t]`）。"有重叠即算"，所以拿到的是覆盖那两秒的完整一两句，
  // 不会切半句。纯前端从已加载的字幕里切，不发请求。
  const panelLines: PanelLine[] = useMemo(() => {
    if (!panel.open) return [];
    const segs = transcript ?? [];
    return segmentsInWindow(segs, panel.tS - 2, panel.tS).map((seg) => {
      const i = segs.indexOf(seg);
      const phrase = highlights.get(i);
      return { i, text: seg.text, phrase, saved: !!phrase && savedTerms.has(phrase.text) };
    });
  }, [panel.open, panel.tS, transcript, highlights, savedTerms]);

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

      <div className="rounded-2xl border border-ink-700 px-4 py-2.5">
        <div className="flex items-center justify-between">
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

        {/* 倍速 + ±N 秒。挤在同一条胶囊的第二行 —— 不另开一块地（D18） */}
        <PlayerControls
          // 只有 YouTube 嵌入有这个毛病（没播过就 seek → 封面被掀掉、剩一块黑）。
          // 播客是 <audio>，没有封面这一层，没播就跳完全正常 —— 别连坐
          canSeek={started || source.kind !== "youtube"}
          step={skipStep}
          rate={rate}
          onStep={changeStep}
          onRate={changeRate}
          onSeekBy={seekBy}
        />
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
        captionLang={prefs.captionLang}
        highlights={highlights}
        savedTerms={savedTerms}
        onToggleTerm={toggleTerm}
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
        lines={panelLines}
        scan={scanState}
        drift={drift}
        autoScan={autoScan}
        onToggleAutoScan={toggleAutoScan}
        onRescan={rescan}
        onToggleTerm={toggleTerm}
        needTargetLang={needTargetLang}
        onAnswerTarget={answerTarget}
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

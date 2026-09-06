import "server-only";
import { GoogleGenAI, MediaResolution } from "@google/genai";
import type { SourceRow, TranscriptSegment } from "@/lib/types";
import { TranscribeError, type TranscribeContext, type TranscribeResult, type TranscriptProvider } from "./types";

// M2a — YouTube 的字幕来源：让 Gemini 自己去看那段视频，逐句转写回来。
//
// 为什么不是「取 YouTube 官方字幕轨」（那本来更准更快）：
// **在 Vercel 的机房 IP 上取不到** —— 三种客户端一律被判成机器人
// （`LOGIN_REQUIRED: Sign in to confirm you're not a bot`）。我在家庭宽带上
// 验过能取，机房不行。整条路已实测作废，别再试（D27，含三条已否决的绕行）。
//
// 这条路的边界也是实测出来的，不是文档上抄的：
// 真正的墙**不是「视频超过 1 小时」，是上下文 100 万 token** —— 一支 2 小时的
// 片子整支喂进去直接 400；**切成 10 分钟一段就完全正常**（实测一段 46 秒、146 行）。

/**
 * **首片只切 2 分钟**，为的是让字幕尽快上屏。
 *
 * 实测（M2a-fix，创始人反馈"等一分钟才见字幕"之后做的）：
 * 耗时跟**输出行数**走，不跟输入量走 —— 10 分钟一片要 20 秒（145 行），
 * 2 分钟一片只要 10 秒（35 行）。用户永远是从 0 秒开始看的，
 * 所以先把开头两分钟送上屏，剩下的边看边补。
 */
const FIRST_CHUNK_S = 120;

/** 其余每片 10 分钟。再大没意义（耗时线性涨），再小则调用次数变多 */
const CHUNK_S = 600;

/**
 * 同时开几片。各片互不相干，本来就该并行 ——
 * 一支 53 分钟的视频排队跑要两分钟，并行只要一分钟出头。
 * 不敢开太多：免费层有每分钟 token 上限，3 路是实测下来稳的档位。
 */
const CONCURRENCY = 3;

/**
 * 每秒 0.05 帧 + 低媒体分辨率。
 *
 * **不是为了快**（实测反而慢 7 秒，因为瓶颈在输出不在输入），
 * **是为了能并行** —— 它把一片的输入从 5 万 token 压到 2 万，
 * 三路同时跑才不会撞上免费层每分钟 25 万 token 的天花板。
 */
const FPS = 0.05;

/** 一片 10 分钟实测约 1 万字符（≈3 千 token），给到 32k 足够宽裕 */
const MAX_OUTPUT_TOKENS = 32_768;

/** 单片最长等这么久。超了就当这一片失败，已转好的仍然算数 */
const CHUNK_TIMEOUT_MS = 120_000;

/** 没有话的那一片，模型会回这个（我们在 prompt 里要求的） */
const NO_SPEECH = "NO_SPEECH";

const MODEL = "gemini-2.5-flash";

/**
 * **字形（简体/繁体）故意不在这儿定**，别再往下面那句里加「写简体」（D50）。
 *
 * 理由：`transcript_cache` 是**跨用户共享**的，按 content_key 存一份、没有字形维度。
 * 在这里定死简体，等于替所有繁体母语的用户做了主，而对简体用户毫无收益 ——
 * 他们那边由**读侧转换**（`src/lib/zh-script.ts`）百分之百保证，不靠模型听话。
 * 下面那句 "Keep the original language" 管的是**语言**（别把上海话翻成英文），
 * 它对字形无能为力也不该管：人说话没有字形，这道题在转写这一层根本无解。
 */
const PROMPT = `Transcribe the speech in this video verbatim.
Output one line per sentence, in exactly this format:
[MM:SS] text
Rules: no commentary, no summary, no markdown, no speaker labels, no blank lines.
Keep the original language — do not translate.
If there is no speech at all, output ${NO_SPEECH}.`;

/**
 * 认 `[MM:SS]` / `[HH:MM:SS]`，也认没有方括号的 —— **模型不老实听格式**：
 * 同一个 prompt，短片那次它回的就是 `00:01 text`（方括号自己丢了）。
 * 与其跟它较劲，不如两种都认。
 */
const LINE = /^\s*\[?(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]?\s*(.+)$/;

interface ParsedLine {
  at: number;
  text: string;
}

export function parseTimestampedLines(raw: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of raw.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, h, mm, ss, text] = m;
    const at = Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
    const clean = text.trim();
    // 模型偶尔把整段包在引号或列表符号里，去掉那层壳
    const stripped = clean.replace(/^[-*•]\s*/, "").trim();
    if (stripped) out.push({ at, text: stripped });
  }
  return out;
}

/**
 * 切片回来的时间戳，**基准是漂的** —— 这条是实测撞出来的，不是想出来的：
 * 同一支视频、同一段 600–1200 秒、同一个 prompt，连打两枪，
 * 一枪回 `[00:00] I'd like to see her…`（相对片头从 0 数），
 * 一枪回 `[10:00] like to see her…`（整支视频的绝对时间）。
 *
 * 所以**不能假设是哪一种，只能当场认**：本片的时间戳如果整体落在
 * [起点, 终点] 这个窗口里，那就是绝对时间，原样用；否则当相对时间，加偏移。
 * 认错的代价很实在 —— 猜"相对"而实际是绝对，整支视频的字幕会翻倍偏移出去。
 */
export function resolveOffset(lines: ParsedLine[], startS: number, endS: number): number {
  if (startS === 0 || lines.length === 0) return 0; // 第一片两种基准是同一回事
  const min = Math.min(...lines.map((l) => l.at));
  const max = Math.max(...lines.map((l) => l.at));
  const TOL = 15; // 模型对齐没那么精确，给一点余量
  const looksAbsolute = min >= startS - TOL && max <= endS + TOL;
  return looksAbsolute ? 0 : startS;
}

/**
 * 把一片的行变成片段。
 * 模型只给起点不给终点，所以每句的终点 = 下一句的起点（最后一句用片尾兜底）。
 */
export function linesToSegments(lines: ParsedLine[], startS: number, endS: number): TranscriptSegment[] {
  const offset = resolveOffset(lines, startS, endS);
  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = offset + lines[i].at;
    // 越界的行直接丢：模型偶尔会多吐一两句片外的，留着就是字幕跳到未来
    if (start >= endS || start < startS - 1) continue;
    const nextAt = i + 1 < lines.length ? offset + lines[i + 1].at : endS;
    segments.push({
      start,
      end: Math.min(Math.max(nextAt, start + 0.5), endS),
      text: lines[i].text,
    });
  }
  return segments;
}

/** SDK 把报错真身当字符串塞在 message 里，剥出 Google 的原话 */
function detailOf(raw: string): string {
  // SDK 把真身当字符串塞在 message 里：`ApiError: {"error":{...}}`
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return raw;
  try {
    const parsed = JSON.parse(json) as { error?: { message?: string } };
    return parsed.error?.message ?? raw;
  } catch {
    return raw; /* 不是 JSON 就用原文 */
  }
}

/**
 * 五类失败，**次序就是判定次序**（429 不是一种错，是一箩筐错，见下面那段病史）。
 *
 * 拆成一个分类器、两个薄壳，是为了让「说什么话」和「要不要给重试按钮」
 * **物理上不可能各说各话** —— 从前它们是两条独立的正则，迟早会漂。
 */
type FailureKind = "spending-cap" | "daily-quota" | "rate-limit" | "unreadable" | "unknown";

/** 消费上限：跟额度无关，等多久都没用，必须去改设置 */
const SPENDING_CAP = /spending cap|spend cap/i;
/** 真·免费额度：Google 会明说是 per day / free tier 的配额 */
const DAILY_QUOTA = /per day|daily limit|free.{0,15}tier|FreeTier/i;
/** 每分钟限流：等一下就好 */
const RATE_LIMIT = /per minute|rate limit|too many requests/i;
/**
 * 视频本身读不了。**这一类跟上面三种有本质区别：重试一万次也不会变。**
 *
 * 最常见的其实不是"私享"，是 **不公开（unlisted）** —— 伯克利那类课程视频
 * 基本都是这种链接，人能打开、播放器也能嵌，但 Gemini 文档明写
 * 「You can only upload public videos (not private or unlisted videos)」，
 * 它那一头直接就够不着。
 */
const UNREADABLE = /not found|private|unlisted|unavailable|403|permission/i;

function classify(raw: string): { kind: FailureKind; detail: string } {
  const detail = detailOf(raw);
  // 前三条**必须排在 UNREADABLE 前面**：额度类的原文里偶尔也带 permission / 403 之类的
  // 字眼，先判它们，才不会把"等一分钟就好"误判成"这条路彻底断了"。
  if (SPENDING_CAP.test(detail)) return { kind: "spending-cap", detail };
  if (DAILY_QUOTA.test(detail)) return { kind: "daily-quota", detail };
  if (RATE_LIMIT.test(detail)) return { kind: "rate-limit", detail };
  if (UNREADABLE.test(detail)) return { kind: "unreadable", detail };
  return { kind: "unknown", detail };
}

/**
 * 这个失败是不是**永久性**的 —— 重试没有任何意义，得换一条路（粘贴字幕）。
 *
 * 只有"视频读不了"算。额度 / 限流 / 消费上限都**不算**：
 * 那三种等一等或改个设置就好了，把「重试」按钮从它们手里拿走反而是帮倒忙。
 *
 * 单独导出而不是让 `explainGeminiError` 改回对象，是因为它有六个调用方
 * （问答 / 聊天 / 翻译 / 扫词都在复用），不值得为这一处把签名全掀了。
 */
export function isPermanentGeminiFailure(raw: string): boolean {
  return classify(raw).kind === "unreadable";
}

/**
 * 把 Gemini 的报错翻译成人话。
 *
 * **这段是被真机打脸打出来的。** 原来的写法是一条正则
 * `/quota|RESOURCE_EXHAUSTED|429/` 命中就说「今天的免费额度用完了，明天再试」。
 * 创始人当天第一支视频、几秒就吃到这句，说「不可能是额度」—— 他是对的。
 * 放探针打出原文才知道，那次 429 的真身是：
 *
 * > `Your project has exceeded its monthly spending cap.`
 *
 * 同样是 429 + RESOURCE_EXHAUSTED，**但让用户「明天再试」是纯粹的误导** ——
 * 消费上限不会隔夜自己涨，得去 AI Studio 把上限改掉。
 *
 * 教训：**429 不是一种错，是一箩筐错**。别用一条正则概括一箩筐。
 * 分不出来的，就把 Google 的原话原样端给用户，也好过编一个错的原因。
 */
export function explainGeminiError(raw: string): string {
  const { kind, detail } = classify(raw);
  switch (kind) {
    case "spending-cap":
      return "Google 那边的项目设了「每月消费上限」，已经到顶了 —— 这不是免费额度用完，等明天也不会好。去 ai.studio/spend 把上限调高或去掉，再回来点「继续生成」。";
    case "daily-quota":
      return "今天的免费额度用完了，明天再试。";
    case "rate-limit":
      return "调用太密集被限流了，等一分钟再点「继续生成」就行。";
    // 永久性的那一类。**措辞只描述病因、不给药方** —— 这个函数还被问答/翻译/扫词
    // 复用，它们那儿"粘贴字幕"是句废话。该怎么办由界面（caption-layer）自己说。
    case "unreadable":
      return "这支视频读不了 —— 自动转写只收公开视频，不公开（unlisted）/ 私享 / 会员 / 地区限制的都拿不到。";
    default:
      return `读这支视频时出错了：${detail.slice(0, 200)}`;
  }
}

function clientFor(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TranscribeError("服务器还没配置 GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
}

async function transcribeChunk(
  ai: GoogleGenAI,
  url: string,
  startS: number,
  endS: number,
): Promise<TranscriptSegment[]> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: { fileUri: url },
            videoMetadata: { startOffset: `${startS}s`, endOffset: `${endS}s`, fps: FPS },
          },
          { text: PROMPT },
        ],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // 转写不需要推理，思考预算全砍掉 —— 省时间也省 token（M0.5 同款）
      thinkingConfig: { thinkingBudget: 0 },
      // 画面压到最低档：我们要的是话，不是画面。为并行腾出 token 预算
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      abortSignal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
    },
  });

  const text = res.text ?? "";
  if (text.trim().startsWith(NO_SPEECH)) return [];
  return linesToSegments(parseTimestampedLines(text), startS, endS);
}

export interface Chunk {
  startS: number;
  endS: number;
}

/**
 * 切片表：首片 2 分钟（抢首屏），其余每片 10 分钟。
 * 边界是**确定的** —— 同一支视频每次算出来都一样，断点续传才对得上。
 */
export function planChunks(totalS: number): Chunk[] {
  const chunks: Chunk[] = [];
  if (totalS <= 0) return chunks;
  const first = Math.min(FIRST_CHUNK_S, totalS);
  chunks.push({ startS: 0, endS: first });
  for (let s = first; s < totalS; s += CHUNK_S) {
    chunks.push({ startS: s, endS: Math.min(s + CHUNK_S, totalS) });
  }
  return chunks;
}

/** 已经转到哪一秒了。空片段 = 一秒都没转 */
function coveredUntil(segments: TranscriptSegment[]): number {
  return segments.length === 0 ? 0 : segments[segments.length - 1].end;
}

export const geminiYoutubeProvider: TranscriptProvider = {
  name: "gemini-youtube",

  supports(source: SourceRow) {
    return source.kind === "youtube" && !!source.url;
  },

  async transcribe({ source, existing, onPartial, remainingMs }: TranscribeContext): Promise<TranscribeResult> {
    const url = source.url;
    if (!url) throw new TranscribeError("这条内容没有可用的视频地址");
    const totalS = source.duration_s && source.duration_s > 0 ? source.duration_s : null;
    if (!totalS) throw new TranscribeError("还不知道这条内容有多长，稍等一下再点一次。");

    const ai = clientFor();
    const plan = planChunks(totalS);

    // 断点续传：已经转过的片子原样留着，只排没转过的
    const done = coveredUntil(existing);
    const segments = existing.filter((s) => s.start < done);
    const todo = plan.filter((c) => c.endS > done);
    if (todo.length === 0) return { segments, complete: true };

    /**
     * 已经转出来的**总秒数**（不是"连续覆盖到第几秒"）。
     *
     * 并行之后各片回来的顺序是乱的：可能第 3 片先好、第 2 片还在跑。
     * 按"连续覆盖"算，进度会卡在 8% 然后突然跳到 100%，看着像卡死了。
     * 按总量算才是用户心里的那个"转了多少了"。
     */
    const finished = new Set<number>();
    const transcribedS = () =>
      plan.reduce(
        (sum, c) => (c.endS <= done || finished.has(c.startS) ? sum + (c.endS - c.startS) : sum),
        0,
      );

    let failure: { message: string; permanent: boolean } | null = null;
    /**
     * 第一片就炸 → 一句都没转出来，抛出去。
     *
     * **包成函数不是为了好看，是为了能编译**：`failure` 只在闭包 `runOne` 里被赋值，
     * TS 的控制流分析看不见那一步，在外层直接 `if (failure)` 会把它收窄成 `never`。
     * 隔一层函数边界，它就老老实实按声明的类型来了。
     */
    const throwIfFailed = () => {
      if (failure) throw new TranscribeError(failure.message, { permanent: failure.permanent });
    };
    /** 转到一半停下来的原因（预算到点是正常的，不算原因；出错才算） */
    let stopReason: string | null = null;
    let stopped = false;

    /**
     * **并行**跑，不排队 —— 各片之间没有任何依赖关系。
     * 一支 53 分钟的视频排队要两分钟，三路并行一分钟出头。
     * 首片（2 分钟那片）单独先跑，好让字幕尽快上屏，别被大片挡在后面。
     */
    const queue = [...todo];

    const runOne = async (chunk: Chunk) => {
      try {
        const got = await transcribeChunk(ai, url, chunk.startS, chunk.endS);
        finished.add(chunk.startS);
        segments.push(...got);
        segments.sort((a, b) => a.start - b.start); // 并行回来的顺序是乱的
        await onPartial({ segments, coveredS: transcribedS(), totalS });
      } catch (e) {
        const rawMessage = e instanceof Error ? e.message : String(e);
        const why = explainGeminiError(rawMessage);
        // 第一片就炸 = 这条内容一句都没转出来，直接失败并把原因说清楚。
        // **顺带把"是不是白重试"一并带出去**：视频读不了那一类，界面得改口。
        if (chunk.startS === 0) {
          failure = { message: why, permanent: isPermanentGeminiFailure(rawMessage) };
          return;
        }
        // 后面的片子炸 = 已转的仍然算数，留 partial 让用户接着来。
        // 但**原因要带出去** —— 从前这里是闷声停下，用户只看到字幕转到一半
        // 就不动了，没人告诉他为什么（消费上限撞顶时正是这个样子）。
        stopReason = why;
        stopped = true;
      }
    };

    const worker = async () => {
      for (;;) {
        if (stopped || failure) return;
        // 预算不够再开一片就收手：已转的都算数，剩下的留给"继续生成"
        if (remainingMs() < 45_000) {
          stopped = true;
          return;
        }
        const chunk = queue.shift();
        if (!chunk) return;
        await runOne(chunk);
      }
    };

    // 首片（2 分钟那片）单独先跑完 —— 约 10 秒字幕就上屏了，
    // 别让它跟后面的大片挤在一起，那样首屏又要等半分钟
    const first = queue.shift();
    if (first) await runOne(first);
    throwIfFailed();

    // 剩下的并行铺开
    if (!stopped && queue.length > 0) {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    }
    throwIfFailed();

    return {
      segments,
      complete: queue.length === 0 && !stopped && finished.size === todo.length,
      note: stopReason,
    };
  },
};

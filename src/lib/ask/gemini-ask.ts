import "server-only";
import { GoogleGenAI, MediaResolution, type Part } from "@google/genai";
import { explainGeminiError, isPermanentGeminiFailure } from "@/lib/transcript/gemini-youtube";
import { langNameEn, normalizeLang } from "@/lib/lang";
import { mmss } from "@/lib/time";
import type { TranscriptSegment } from "@/lib/types";

// M3 打断问答 —— 用户卡在某一刻打字问一句，Gemini Flash 扣着当前字幕直接答。
//
// 这是**通用问答**，不套教学法：不反问、不「你先猜猜看」。苏格拉底式那套是 M4 学习模式，
// 教学法唯一来源是 SKILL.md，这里刻意不碰（AGENTS.md：别在代码里另写教学逻辑）。
//
// 接地范围 = 窗口 [t−15, t+3]（他刚听到的那几句，焦点）+ 全文（背景，兜住指代）。
// —— WORKORDER §「打断问答（Gemini Flash，窗口+全文上下文）」。

const MODEL = "gemini-2.5-flash";

/** 单次问答最长等这么久 */
const ANSWER_TIMEOUT_MS = 60_000;

/**
 * 「看画面再答」（M3.16，D75）多一步：模型要先去 YouTube 取那一段。**慢多少没量过**（计划「开工先量」第 1 条）——
 * 界面上把秒数亮给他看、预览站上量；这里先给宽一点，别让一次本来能答出来的看画面被 60 秒掐掉
 */
const LOOK_TIMEOUT_MS = 90_000;

/** 答案够用就行，别让它写论文；也压住 token 成本 */
const MAX_OUTPUT_TOKENS = 2_048;

/** 全文只作背景，超这么多字符就掐尾 —— Flash 能吃百万 token，但没必要为一次问答烧那么多 */
const FULL_TRANSCRIPT_CHAR_CAP = 24_000;

/**
 * 问答那一路喂的是**带时间的**全文（每行多出「[02:43] 」约 8 个字符），上限跟着放宽一点 ——
 * 别因为加了时间就比原来少喂一截字幕
 */
const TIMED_TRANSCRIPT_CHAR_CAP = 32_000;

export class AskError extends Error {
  /**
   * 视频本身读不了（不公开 / 私享 / 会员 / 地区限制）—— 重试一万次也一样。
   * 只有「看画面再答」那一趟会碰到：路由拿它换一句专门的话（「AI 看不了这支视频的画面…原答案还在」），
   * 而不是 `explainGeminiError` 那句「自动转写只收公开视频」—— 他点的不是转写（M3.16，D75）
   */
  readonly unreadable: boolean;

  constructor(message: string, options?: { unreadable?: boolean }) {
    super(message);
    this.name = "AskError";
    this.unreadable = options?.unreadable ?? false;
  }
}

export interface AskContext {
  question: string;
  segments: TranscriptSegment[];
  /** 打断点窗口 [start, end]，落库时按 D5 定死的 t−15 / t+3 */
  windowStartS: number;
  windowEndS: number;
  /** 卡在第几秒（只用来告诉模型「他卡在 MM:SS」） */
  tS: number;
  title: string | null;
  /** D42 修订③：用户母语 —— 现在只是**兜底**（问句看不出语言时才用）。空 = 还不知道 */
  nativeLang?: string | null;
  /**
   * D56「说短一点」：**拿同一份 context 重答一版更短的**。
   *
   * 它是 M3.15 片 b 那三颗按钮里的第三颗。三件事必须一起成立才算做对：
   * ① 原答案**不覆盖**（调用方负责：`brief` 这一趟不写库）；
   * ② 两版**可来回切**（前端把短版留在内存里，切回去不再花钱）；
   * ③ **不点就一分钱不花**（D44：花钱的动作只由人点）。
   */
  brief?: boolean;
  /**
   * M3.16「看画面再答」（D75）：**这一趟把提问前后那一段视频也交给模型看**。
   * 喂法照抄自动转写（`gemini-youtube.ts`：`fileData.fileUri` = YouTube 链接 + `videoMetadata` 截一段），
   * 只认公开的 YouTube 视频 —— 调用方负责只在 YouTube 上传它。
   */
  look?: {
    /** YouTube 观看页链接（`sources.url`） */
    url: string;
    /** 看哪一段（整秒）—— `lib/look.ts` 的 `lookClip` 算的，界面角标上写的也是它 */
    fromS: number;
    toS: number;
    /** 之前只看字幕给他的那版回答 —— 画面说明它不对或不全，就让模型直说 */
    previousAnswer: string | null;
  };
  /**
   * M3.15 片 c（D64）：「视频别处还讲到」**不写成正文里的一段话，改成答案后面一段结构化的指路**
   * （`[[REFS]]` 一行，下面每行一个 `{"t","quote","note"}`）—— 服务端拿原句去字幕里核对、吸附，问答栏画成概述卡。
   * 只有宽屏问答栏会传（手机上的暂停面板照旧是那一段话，一个字不变）；`brief` / `look` 这两趟不写指路
   * （短版本来就不写第②段；看画面那版的指路卡片已经在只看字幕那版上了）。
   */
  cards?: boolean;
  /** 逐块回调：流式把答案吐给上层 */
  onChunk: (text: string) => void | Promise<void>;
}

export function clientFor(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AskError("服务器还没配置 GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
}

/** 窗口 [start,end] 内（有重叠即算）的逐句原文 —— 用户「刚听到的那几句」，问答的焦点。沉浸聊天也复用 */
export function windowText(segments: TranscriptSegment[], startS: number, endS: number): string {
  return segments
    .filter((s) => s.start <= endS && s.end >= startS)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

// ── 问句是什么语言：**代码判，不交给模型猜**（2026-09-13 创始人：「一定严格让 ai 根据问的语言回复」）──
//
// D42 修订③（2026-09-09）定了规矩：答案跟着问句的语言走。当时只写进了提示词 ——
// 而这篇提示词**整篇是中文**、字幕是英文、那条规矩压在最后一行。真机上的结果：
// 「what are they doing」「I am asking what does Maverick see…」两句英文问题都拿到了整段中文答案。
// 模型被一整篇中文指令带着走，最后那一句「看问句用的语言」拗不过它。
//
// 所以语言由这里判定，再写一句**点名道姓**的硬指令（「整段用英文」，不是「用他问句的语言」），
// 放进 systemInstruction、并在提示词末尾再说一遍。判法只用最稳的两个信号：
// **用的是哪套文字** + **英文里才有的高频词**；判不准就老实说判不准，退回原来的规矩。

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;
const LETTER = /\p{L}/u;

/**
 * 只在英文里常见、在别的拉丁字母语言里几乎不单独出现的词。
 * **刻意没收**的：`is / was / do / to / of / for / no / me / my / we / he / i / am / will`
 * —— 它们在德语（was、am、will）、荷兰语（is、of）、西语（no、me、he）、波兰语（to、my、we）、
 * 意大利语（i、do）里也是常用词，收进来就会把一句德语问题判成英文。
 */
const ENGLISH_MARKERS = new Set([
  "the", "what", "what's", "why", "how", "who", "which", "where", "when",
  "does", "doing", "did", "are", "were", "can", "could", "would", "should",
  "this", "that", "these", "those", "they", "them", "their", "she", "his", "it", "its", "it's",
  "you", "your", "and", "but", "not", "with", "from", "about", "before", "after",
  "now", "then", "than", "there", "here", "just", "again", "really", "please",
  "reply", "answer", "mean", "means", "meaning", "say", "says", "said", "saying",
  "tell", "explain", "happen", "happens", "happening", "happened", "english",
  "don't", "doesn't", "isn't", "aren't", "can't",
]);

/** 判出来的问句语言。`latin` / `other` = 知道不是中英日韩，但分不清是哪一门 */
export type QuestionLang = "zh" | "ja" | "ko" | "en" | "latin" | "other";

/**
 * 这句问题是用什么语言问的。**判不出来返回 null**（一个符号、一串数字、单单一个术语词）。
 *
 * 中日韩和拉丁字母混着写很常见，所以按「词」对「词」比，不是看有没有汉字：
 * 中文平均约 1.5 个字一个词 ——「他说的 flywheel 是什么」是中文问句，
 * 「what does 遥遥领先 mean」是英文问句（一个外国人在问一个中文说法，D42：任意语言对）。
 */
export function questionLanguage(question: string): QuestionLang | null {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  let other = 0;
  for (const ch of question) {
    if (KANA.test(ch)) kana++;
    else if (HANGUL.test(ch)) hangul++;
    else if (HAN.test(ch)) han++;
    else if (LATIN.test(ch)) latin++;
    else if (LETTER.test(ch)) other++;
  }
  const words = question.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const cjk = han + kana + hangul;
  if (cjk >= 2 && cjk / 1.5 >= words.length) {
    if (kana > 0) return "ja"; // 日文里汉字常比假名多 —— 有假名就是日文（text-script.ts 同一条特事特办）
    if (hangul > han) return "ko";
    return "zh";
  }
  if (latin >= 2 && words.length > 0) {
    if (words.some((w) => ENGLISH_MARKERS.has(w))) return "en";
    // 只有一个词、又不是英文虚词 —— 多半是在问一个术语（「flywheel?」）。
    // 这正是 D42 修订③ 留给母语兜底的那一类（「他可能只是懒得切输入法」）
    if (words.length < 2) return null;
    return "latin";
  }
  if (other >= 2 && other > latin) return "other";
  return null;
}

/** 问句里自己点名要哪门语言时（「reply in English」「用中文回答」），听他的 —— 每一条硬指令都带这一句 */
const EXPLICIT_WINS =
  "If the question itself explicitly asks for a particular language (e.g. “reply in English”, “用中文回答”), use that language instead.";

/**
 * **答案语言 = 他这次提问所用的语言。**（D42 修订③，2026-09-09 创始人拍板；2026-09-13 改成代码判定）
 *
 * ⚠️ 这是**掉头**，不是补丁 —— D42 原来（⑶）特意把答案语言钉死在母语上，
 * 理由是：他用英文问一句 "what does XX mean"，可能只是懒得切输入法，
 * 母语是我们知道的事实，没理由让模型猜。**那条理由现在被更强的场景压过去了**：
 * 产品要给外国人用，对方用英文问就必须英文答，不能因为设置里母语还写着中文
 * 就整段中文回过去 —— 那一刻「母语」根本不是他的母语。
 *
 * 母语没有作废，**退居兜底**：问句短到看不出语言时（只有一个术语、一串符号、
 * 一个链接）才用它。这样「懒得切输入法」那个老场景里最脆弱的一类（单个英文词）
 * 依然走母语，而整句英文提问走英文。
 *
 * **2026-09-13 起语言由 `questionLanguage` 在代码里判好，这里写的是点名道姓的硬指令** ——
 * 原来那句「用他这次提问所用的那种语言回答」交给模型自己判，真机上两句英文问题都被答成了中文。
 * 不传 `question`（老调用方）就退回原来那条让模型自己看的规矩。
 *
 * 🚩 **界面语言（`uiLang`）一个字都不许进这里**，D42 红线原封不动。
 * 中/EN 那颗按钮换的是界面，不是 AI 的嘴。快捷问按钮是唯一的间接影响：
 * 它发出去的那句话本身就是界面语言写的，所以答案跟着它走 —— 这是对的，
 * 因为那句话确实是"用户问出去的问题"。
 */
export function answerLanguageRule(nativeLang: string | null | undefined, question?: string): string {
  const code = normalizeLang(nativeLang);
  const lang = question ? questionLanguage(question) : null;
  const quotes = "Quoted caption lines may stay in their original language.";
  switch (lang) {
    case "en":
      return (
        "LANGUAGE — MANDATORY: the user's question is written in English, so write your ENTIRE answer in English, " +
        `even though these instructions and the transcript are in other languages. ${quotes} ${EXPLICIT_WINS}`
      );
    case "zh":
      return (
        "语言（必须遵守）：他这句是用中文问的 —— 整段答案都用中文写，简体还是繁体跟着他的问句走；引用的字幕原句可以保留原文。" +
        `LANGUAGE — MANDATORY: write the entire answer in Chinese. ${EXPLICIT_WINS}`
      );
    case "ja":
    case "ko": {
      const name = langNameEn(lang);
      return `LANGUAGE — MANDATORY: the user's question is written in ${name}, so write your ENTIRE answer in ${name}. ${quotes} ${EXPLICIT_WINS}`;
    }
    case "latin":
    case "other":
      return (
        "LANGUAGE — MANDATORY: write your ENTIRE answer in the same language the user's question is written in — " +
        `not the language of these instructions, and not the language of the transcript. ${quotes} ${EXPLICIT_WINS}`
      );
    default: {
      // 看不出来（或老调用方没传问句）：原来那条规矩，母语兜底
      const fallback = code
        ? `问句短到看不出是什么语言时（只有一个词、一串符号、一个链接），用${langNameEn(code)}（${code}）。`
        : "";
      return (
        "用**他这次提问所用的那种语言**回答：他用中文问就整段中文，用英文问就整段英文，" +
        "其他语言同理；多轮对话看他最新那条。判断只看问句本身主要用的是哪种语言 —— " +
        `问句里引用的外语词、以及内容原文是什么语言，都不作数。${fallback}`
      );
    }
  }
}

/**
 * 备忘（compact）用的语言规则 —— **和上面那条故意不同**。
 *
 * 备忘不是"回答"，是塞回下一轮 systemInstruction 的内部笔记，用户看不到。
 * 它必须**跨轮稳定**：跟着"最新那条问句"走的话，用户中英夹着问几句，
 * 备忘就会一段中文一段英文地长下去。所以这里保留 D42 原来的做法 —— 钉死母语。
 */
export function memoLanguageRule(nativeLang: string | null | undefined): string {
  const code = normalizeLang(nativeLang);
  if (!code) return "";
  return `备忘正文用${langNameEn(code)}（${code}）写。`;
}

/** 全文作背景，超预算掐尾。沉浸聊天也复用 */
export function backgroundText(segments: TranscriptSegment[]): string {
  const all = segments
    .map((s) => s.text)
    .join(" ")
    .trim();
  if (all.length <= FULL_TRANSCRIPT_CHAR_CAP) return all;
  return `${all.slice(0, FULL_TRANSCRIPT_CHAR_CAP)}…（全文较长，仅取前段作背景）`;
}

/**
 * **带时间的**逐句原文：一行一句，「[02:43] Rooster, where are you?」。
 *
 * 问答要指路（「后面 MM:SS 还会讲到」），就得先把时间给它 ——
 * **2026-09-13 之前喂进去的字幕一个时间都没有**（上面那两个函数只拼文字），
 * 模型写出来的每一个 MM:SS 都是估的：创始人那张截图里 AI 说「02:49 他说了 Rooster, where are you?」，
 * 字幕栏里那句明明是 02:43。时间戳还没有核对 / 吸附（D64，片 c），但至少现在有真时间可抄。
 */
function timedLines(segments: TranscriptSegment[], fromS = -Infinity, toS = Infinity): string {
  return segments
    .filter((s) => s.start <= toS && s.end >= fromS && s.text.trim())
    .map((s) => `[${mmss(s.start)}] ${s.text.trim()}`)
    .join("\n");
}

function timedBackground(segments: TranscriptSegment[]): string {
  const all = timedLines(segments);
  if (all.length <= TIMED_TRANSCRIPT_CHAR_CAP) return all;
  return `${all.slice(0, TIMED_TRANSCRIPT_CHAR_CAP)}\n…（全文较长，仅取前段作背景）`;
}

function buildPrompt(ctx: AskContext): string {
  const focus = timedLines(ctx.segments, ctx.windowStartS, ctx.windowEndS);
  const background = timedBackground(ctx.segments);
  const where = ctx.title ? `《${ctx.title}》` : "这段内容";
  const look = ctx.look;
  return [
    `你是学习助手。用户正在看 ${where}，在 ${mmss(ctx.tS)} 处卡住了，想问你一句。`,
    // M3.16（D75）：他点了「看画面再答」—— 告诉模型它这次看得到什么、他停在那一段的哪儿
    look
      ? `这一次**你看得到画面**：随这段话附上的视频，就是他卡住前后那一段（${mmss(look.fromS)}–${mmss(look.toS)}；` +
        `他停在 ${mmss(ctx.tS)}，在这一段快结束的地方）。他特意点了「看画面再答」—— 多半问的是画面上发生的事，字幕里没有。`
      : "",
    "（下面的字幕每行开头方括号里是那一句开始的时间。）",
    "",
    "【他刚听到的（回答的焦点，扣住这里）】",
    focus || "（这一刻附近没有字幕）",
    "",
    "【全文背景（仅供参考，别硬塞）】",
    background || "（没有更多字幕）",
    "",
    `【他的问题】\n${ctx.question}`,
    "",
    // 看画面那一趟：把只看字幕那版一起给它 —— 他点这颗按钮，往往就是因为那版答偏了（他那次：画面上是导弹，那版说「敌机来了」）
    look?.previousAnswer ? `【之前只看字幕给他的回答（没看画面，可能不对或不全）】\n${look.previousAnswer}\n` : "",
    // ── 答案的形状是**有顺序的**（计划 §B.5，创始人第一轮的原话）──
    //
    // 「先简要解释相关概念 → 再说视频前后哪里还讲到这件事并标出时间」。
    // 不是把两件事揉成一段：**先给他一个当场能用的答案，再给他「后面还有」**。
    // 揉在一起的写法在真机上是这样的：他想知道这个词什么意思，
    // 读到第三行还在讲"这个视频 18:20 也提到过"。
    //
    // 第二段有两种写法（片 c，2026-09-18）：
    // · **宽屏问答栏**（`cards`）：结构化的指路 → 服务端拿原句去字幕里核对、吸附（`lib/ask/refs.ts`，D64）→ 画成概述卡；
    // · **手机暂停面板**（不传 `cards`）：照旧是正文里的一段话，**没核对过** —— 下面那句「只抄方括号里的时间」
    //   只是提示词层面的约束，不是校验。生产库里 30 条这种指路，原句 32 句全是真的，时间却有 22 个是错的（最多差 12 分钟）。
    //
    // 那两句套话**不再写死中文**（2026-09-13）：英文答案里夹一句「前面 02:44 还会讲到」就是破功；
    // 而「前面……还会讲到」本身也不通 —— 往前的是「讲过」。
    "要求：",
    look
      ? "① 先说画面上看到了什么（谁、在做什么、有什么东西、怎么动），再直接回答他问的那件事；" +
        "画面和字幕说的不一样时以画面为准，并说明是在画面里看到的。" +
        "之前那版只看字幕的回答如果被画面证明不对或不全，直接指出来。" +
        "看不清就说看不清，别编画面里没有的东西，别反问让他先猜。"
      : "① 先直接、简洁地回答他问的那件事，扣住他卡住的那几句；" +
        "别跑题、别编内容里没有的、别反问让他先猜。",
    // ── 片 c（D64）：宽屏问答栏要的是**结构化的指路**，服务端核对原句、问答栏画成概述卡 ──
    // 正文里不许再写那一段（卡片就是它；两样都写，同一件事在屏幕上出现两遍）。
    // 看画面那一趟（cards + look）第②段整个不写：指路卡片已经挂在只看字幕那版上了，
    // 而 `interrupts.refs` 只有一列 —— 画面版再给一套就没地方放、也不该盖掉那一套。
    ctx.cards && look
      ? "② 这一版**不用写**「视频别处还讲到」的指路（那几处已经标出来了），答完画面这件事就停。"
      : ctx.cards && !ctx.brief
        ? "② 如果这条内容的**别处**（往前往后都行，但不是他刚听到的那几句）确实还讲到这件事：" +
          "**正文里不要写指路的那一段**（界面会把它画成可以点的卡片）；" +
          "改成在答案最后单独起一行，只写 [[REFS]]，下面每行一个 JSON，最多 3 行，格式：\n" +
          '{"t":"MM:SS","quote":"那一行字幕的原文","note":"一句话：那儿讲了什么"}\n' +
          "t 只能照抄字幕里方括号标的时间，不许自己估；" +
          "quote 必须从上面的字幕里**一字不差地抄**，保持字幕原文的语言 —— 不翻译、不改词、不加自己的话，可以只抄一句里的一段；" +
          "note 用回答所用的语言写，一句话，不超过 20 个词；" +
          "不要写「后面 / 前面 / Later / Earlier」这类方向词，也不要写时间（卡片上已经标了）。" +
          "别处没讲到、或者拿不准，就**整段不写**（连 [[REFS]] 也不写）—— 宁可没有，也不要给一个对不上的。"
        : "② 如果这条内容的**别处**确实还讲到这件事，答完之后另起一段指路：" +
          "往后的写「后面 MM:SS 还会讲到……」，往前的写「前面 MM:SS 讲过……」" +
          "（这两句也要换成回答所用的语言，英文就写 “Later at MM:SS …” / “Earlier at MM:SS …”），" +
          "并把那一句的**字幕原句**一起引出来。" +
          "**MM:SS 只能照抄字幕里方括号标的时间，不许自己估。**" +
          "**只在字幕里真找得到的时候才提；不确定就整段不写** —— 宁可只答第一段，" +
          "也不要给一个对不上的时间。",
    ctx.brief
      ? "③ 这一版**要短**：只留最要紧的那一层意思，三句以内；不铺垫、不复述他的问题、不列点。" +
        "第②段这一版**不写**。"
      : "",
    // 语言规矩压在最后一行、并且 systemInstruction 里再放一遍（见 askQuestion）
    answerLanguageRule(ctx.nativeLang, ctx.question),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 流式问答。逐块 `onChunk` 吐出，全部收完返回完整答案（给调用方落库用）。
 * 出错统一包成 AskError，说人话（额度/限流/私享视频等复用 explainGeminiError）。
 */
export async function askQuestion(ctx: AskContext): Promise<string> {
  const ai = clientFor();
  const prompt = buildPrompt(ctx);
  const look = ctx.look;

  // M3.16（D75）：看画面那一趟，视频放在提示词**前面**（先给材料、再给问题）。
  // 喂法和自动转写那条一模一样（`gemini-youtube.ts` 的 transcribeChunk）—— 那条从 M2 起在生产上跑着；
  // 不同的只有每秒 1 帧（转写是 0.05：它要的是话，这里要的正是画面）
  const parts: Part[] = look
    ? [
        {
          fileData: { fileUri: look.url },
          videoMetadata: { startOffset: `${look.fromS}s`, endOffset: `${look.toS}s`, fps: 1 },
        },
        { text: prompt },
      ]
    : [{ text: prompt }];

  let answer = "";
  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        // 答案语言单独放进 systemInstruction —— 提示词正文是一整篇中文 + 一整篇字幕，
        // 只在正文末尾说一句，拗不过前面几千字（2026-09-13 真机：英文问句拿到过整段中文答案）
        systemInstruction: answerLanguageRule(ctx.nativeLang, ctx.question),
        temperature: 0.3,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // 通用问答不需要长链推理，思考预算砍掉省时省钱（与转写/翻译同款）
        thinkingConfig: { thinkingBudget: 0 },
        // 画面压到低档（每帧约 66 token，转写同一档）：12 秒 ≈ 1,200 token（计划里的估算）
        ...(look ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
        abortSignal: AbortSignal.timeout(look ? LOOK_TIMEOUT_MS : ANSWER_TIMEOUT_MS),
      },
    });
    for await (const chunk of stream) {
      const piece = chunk.text;
      if (piece) {
        answer += piece;
        await ctx.onChunk(piece);
      }
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // 「视频读不了」这一类要单独认出来 —— 只在看画面那一趟才有意义（普通问答根本不碰视频）
    throw new AskError(explainGeminiError(raw), { unreadable: Boolean(look) && isPermanentGeminiFailure(raw) });
  }

  const trimmed = answer.trim();
  if (!trimmed) throw new AskError("这次没答出内容，换个问法再问一次。");
  return trimmed;
}

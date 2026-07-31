import { TARGET_LANGS } from "@/lib/translate/langs";

// M3.7 —— 三语言框架的纯函数层（WORKORDER **D42**，地基级）。
//
// Fermata 不是"中文人学英文"的产品，是**任意母语 × 任意内容语言**。三个语言各管各的：
//   content_lang —— 这条内容是什么语言（转写模型实测报的，存 sources）
//   native_lang  —— 用户母语（AI 用它解释、译文译成它、界面默认也是它）
//   target_lang  —— 想学的语言，**可空 = 我是来学知识的，不是来学语言的**
// 三者的关系**自动**决定 AI 干什么，不靠用户选模式。
//
// **D24：这份必须是纯函数**（客户端也要用它判定模式），一行服务端依赖都不许有。
// TARGET_LANGS 是张静态表，安全。

/** 学什么 —— 由三个语言的关系推出来，不是用户选的开关 */
export type StudyMode =
  /** 学语言：标地道表达 / 搭配 / 口语说法 */
  | "language"
  /** 学知识：标术语 / 概念 / 行话 */
  | "knowledge"
  /** 内容既非母语也非目标语：两者都标、偏术语 */
  | "mixed";

/**
 * 语言写法有三套，不归一就全对不上：
 *   转写模型（Whisper）报的是**全称**小写 —— "english" / "chinese"
 *   navigator.language 报的是 **BCP-47 带地区** —— "zh-CN" / "en-US"
 *   TARGET_LANGS 里写的是**带字形** —— "zh-Hans" / "zh-Hant"
 * 这个映射把常见全称收进来；TARGET_LANGS 的英文名也自动进表（"Simplified Chinese" → zh-Hans）。
 */
const ALIASES: Record<string, string> = {
  english: "en",
  chinese: "zh",
  mandarin: "zh",
  "mandarin chinese": "zh",
  cantonese: "zh",
  japanese: "ja",
  korean: "ko",
  spanish: "es",
  castilian: "es",
  french: "fr",
  german: "de",
  russian: "ru",
  portuguese: "pt",
  italian: "it",
  arabic: "ar",
  hindi: "hi",
  thai: "th",
  vietnamese: "vi",
  dutch: "nl",
  polish: "pl",
  turkish: "tr",
  indonesian: "id",
  ...Object.fromEntries(TARGET_LANGS.map((l) => [l.name.toLowerCase(), l.code])),
};

/** 像不像一个语言码（"en" / "zh-Hans" / "pt-BR"），而不是一句人话 */
const LOOKS_LIKE_CODE = /^[a-z]{2,3}(-[a-z0-9]+)*$/i;

/**
 * 归一到一个能比较的写法。认不出来就原样返回（trim 过）——
 * **绝不猜成 "en"**：猜错语言比不知道语言更糟，那正是 D42 要根除的偏见。
 */
export function normalizeLang(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";

  const alias = ALIASES[t.toLowerCase()];
  let code = alias ?? "";
  if (!code) {
    if (!LOOKS_LIKE_CODE.test(t)) return t; // 一句人话，不是语言码 —— 原样奉还，别硬猜
    const [primary, ...rest] = t.split("-");
    code = [primary.toLowerCase(), ...rest].join("-");
  }

  // 中文特事特办：TARGET_LANGS 用的是字形码（zh-Hans / zh-Hant），而外面进来的是
  // `zh-CN` / `zh-TW` / `chinese`。不收拢的话「简体/繁体」只能靠主子标签猜，
  // 而把 zh-TW 猜成简体是明显的错。
  const lower = code.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    return /hant|-tw|-hk|-mo/.test(lower) ? "zh-Hant" : "zh-Hans";
  }
  return code;
}

/** 主子标签。"zh-Hans" / "zh-CN" / "zh" 都是 "zh" */
function primaryOf(raw: string | null | undefined): string {
  const n = normalizeLang(raw);
  return n ? n.split("-")[0].toLowerCase() : "";
}

/**
 * 算不算同一门语言。**只比主子标签** —— 简体繁体、英美英语，
 * 在"该给他标什么"这件事上是同一门语言。两边有一个不知道就返回 false。
 */
export function sameLang(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = primaryOf(a);
  const pb = primaryOf(b);
  return pa !== "" && pa === pb;
}

/** 在 TARGET_LANGS 里找这门语言：先精确码，再退主子标签 */
function lookup(raw: string | null | undefined) {
  const n = normalizeLang(raw);
  if (!n) return null;
  const exact = TARGET_LANGS.find((l) => l.code === n);
  if (exact) return exact;
  const p = primaryOf(n);
  return TARGET_LANGS.find((l) => primaryOf(l.code) === p) ?? null;
}

/** 给用户看的写法（母语写法，如「简体中文」「English」）。认不出就原样返回 */
export function langLabel(raw: string | null | undefined): string {
  return lookup(raw)?.label ?? normalizeLang(raw);
}

/** 塞进 prompt 的英文名（「answer in Simplified Chinese」）。认不出就原样返回 */
export function langNameEn(raw: string | null | undefined): string {
  return lookup(raw)?.name ?? normalizeLang(raw);
}

/**
 * D42 的四条规则，一比一落地，**不许自创**：
 *   ⑴ target 空 → 学知识
 *   ⑵ content == native → 学知识（他在用母语搞懂内容）
 *   ⑶ content == target ≠ native → 学语言
 *   ⑷ 其余 → mixed
 *
 * 内容语言未知（还没转写、或模型没报）时落到 mixed —— 两者都标、偏术语，
 * 是这里唯一诚实的兜底：**不知道就别装作知道**。
 */
export function studyMode(
  contentLang: string | null | undefined,
  nativeLang: string | null | undefined,
  targetLang: string | null | undefined,
): StudyMode {
  if (!normalizeLang(targetLang)) return "knowledge";
  if (sameLang(contentLang, nativeLang)) return "knowledge";
  if (sameLang(contentLang, targetLang)) return "language";
  return "mixed";
}

// ── 用户的三个语言偏好（存 user_settings.settings，迁移 0006 的表，零新迁移） ──

export interface LangPrefs {
  /** 母语。空 = 还没探到（LangBootstrap 会用 navigator.language 补上） */
  nativeLang: string;
  /**
   * 想学的语言。三态，别合并：
   *   `null` = **还没问过他**（该弹那一句问询）
   *   `""`   = 问过了，他说只想搞懂内容（**别再问**）
   *   其余   = 语言码
   */
  targetLang: string | null;
  /**
   * 界面语言。**空 = 跟母语走**（D42：默认跟 native_lang，但可单独覆盖 ——
   * 很多人母语中文却要英文界面）。留空而不是复制一份母语值，
   * 这样以后改母语界面会自动跟上，除非他明确指定过。本片只存不用，M3.9 才消费它。
   */
  uiLang: string;
  /**
   * 字幕译文语言。三态，和 targetLang 同一套：
   *   `null` = 键不存在（M2.9 那会儿存在 localStorage，还没搬过来）
   *   `""`   = 他明确关掉了译文（**别再从 localStorage 把旧值搬回来**）
   */
  captionLang: string | null;
}

export const DEFAULT_LANG_PREFS: LangPrefs = {
  nativeLang: "",
  targetLang: null,
  uiLang: "",
  captionLang: null,
};

/** 已经问过目标语言了吗（`""` 也算问过 —— 他明确说了不学语言） */
export function targetAsked(prefs: LangPrefs): boolean {
  return prefs.targetLang !== null;
}

/** 界面该用哪门语言（M3.9 消费）。uiLang 空就跟母语 */
export function effectiveUiLang(prefs: LangPrefs): string {
  return prefs.uiLang || prefs.nativeLang;
}

/**
 * 从 `user_settings.settings` 这坨 jsonb 里挑出三个语言。
 * 服务端与客户端共用一份解析，免得两边对"没设过"的判断走样。
 */
export function readLangPrefs(settings: Record<string, unknown> | null | undefined): LangPrefs {
  const s = settings ?? {};
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return {
    nativeLang: normalizeLang(str(s.nativeLang)),
    // 键不存在 → null（还没问）；存在但是空串 → ""（问过了，不学语言）
    targetLang: typeof s.targetLang === "string" ? normalizeLang(s.targetLang) : null,
    uiLang: normalizeLang(str(s.uiLang)),
    // 同上三态：键不存在 → null（还没从 localStorage 搬过来）；"" → 他关掉了译文
    captionLang: typeof s.captionLang === "string" ? s.captionLang.trim() : null,
  };
}

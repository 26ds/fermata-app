import { normalizeLang } from "@/lib/lang";

// D51 —— 「这条内容是什么语言」这个标签**可能是假的**，用之前先跟正文对一眼。
//
// **为什么非有这一层不可**（2026-08-07 真机撞出来的）：
// `sources.content_lang` 的数据库默认值是 `'en'`（`0001_init.sql`，D42 点名过的早期偏见）。
// 导入时显式写 `null` 是 **2026-07-31（M3.7）才加的** —— 在那之前导入的每一条内容，
// 这一列都躺着一个 `'en'`，**包括满屏中文的视频**。后果是静默的：
// `/api/translate` 看见「原文=en、目标=en」就判定不用翻，于是用户点了英文译文
// 什么也没发生，而提示语还不肯说它以为原文是什么语言。
//
// **修法不是去猜，是去核对**：语言标签可以撒谎，**正文用的是哪套文字不会**。
// 满屏汉字的东西绝不可能是英语。对不上就别信那个标签。
//
// 这不是语言识别，是**测谎**：只做"标签和正文明显冲突"这一种判断，
// 分不清的（法语标成英语，两边都是拉丁字母）就老实承认分不清、照旧信标签。
//
// **纯函数层**（D24）：客户端也能用，一行服务端依赖都没有。

/** 粗到不能再粗的文字分类。只要能拆穿"汉字冒充英语"这种谎就够了 */
export type TextScript =
  | "han"
  | "kana"
  | "hangul"
  | "latin"
  | "cyrillic"
  | "arabic"
  | "devanagari"
  | "thai";

const PATTERNS: [TextScript, RegExp][] = [
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["han", /\p{Script=Han}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["thai", /\p{Script=Thai}/u],
  ["latin", /\p{Script=Latin}/u],
];

/** 标点、数字、空白 —— 哪种语言里都有，不能拿来判断 */
const IGNORE = /[\s\p{P}\p{S}\p{N}]/u;

/**
 * 这段文字主要用哪套文字写的。**拿不准就返回 null**（太短、或者混得没有主次），
 * 那时候一律信标签 —— 宁可漏判，也不要把对的标签当成假的。
 */
export function dominantScript(text: string): TextScript | null {
  const counts = new Map<TextScript, number>();
  let total = 0;
  for (const ch of text) {
    if (IGNORE.test(ch)) continue;
    total++;
    for (const [name, re] of PATTERNS) {
      if (re.test(ch)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        break; // PATTERNS 有序：假名先于汉字命中，日文才不会被认成中文
      }
    }
  }
  if (total < 12) return null; // 太短，判了也不作数

  // 日文特事特办：**只要有像样比例的假名就是日文**。日文正文里汉字常常比假名多，
  // 按"谁最多"算会把日文判成 han，反过来诬告 `ja` 这个标签是假的。
  if ((counts.get("kana") ?? 0) / total > 0.05) return "kana";

  let best: TextScript | null = null;
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best && bestN / total > 0.5 ? best : null;
}

/** 这门语言**该**用哪套文字写。表里没有的返回 null（不知道就别judge） */
export function scriptOfLang(lang: string | null | undefined): TextScript | null {
  const code = normalizeLang(lang).split("-")[0].toLowerCase();
  switch (code) {
    case "zh":
      return "han";
    case "ja":
      return "kana";
    case "ko":
      return "hangul";
    case "ru":
      return "cyrillic";
    case "ar":
      return "arabic";
    case "hi":
      return "devanagari";
    case "th":
      return "thai";
    case "en":
    case "es":
    case "fr":
    case "de":
    case "pt":
    case "it":
    case "vi":
      return "latin";
    default:
      return null;
  }
}

/** 正文这套文字，最可能是哪门语言。只写**几乎不会错**的那几条，其余承认不知道 */
function langOfScript(script: TextScript): string | null {
  switch (script) {
    case "han":
      return "zh"; // 已排除假名，所以不会是日文
    case "kana":
      return "ja";
    case "hangul":
      return "ko";
    case "thai":
      return "th";
    case "devanagari":
      return "hi";
    // 拉丁 / 西里尔 / 阿拉伯字母都是好多门语言共用的，猜不得
    default:
      return null;
  }
}

export interface ResolvedContentLang {
  /** 可以放心用的语言码。`null` = 老实说不知道（**比编一个更好**） */
  lang: string | null;
  /** 库里存的那个标签跟正文对不上，被推翻了 —— 调用方该顺手把库里那行治好 */
  corrected: boolean;
}

/**
 * 把库里存的 `content_lang` 和正文核对一遍，返回**可以放心用的**那一个。
 *
 * 三种结果：
 *   标签空着 → `null`（本来就不知道，谈不上纠正）
 *   标签与正文这套文字**对得上**、或者正文判不出来 → 原样信它
 *   **对不上** → 推翻它。正文那套文字能唯一指向一门语言就用那门，否则返回 `null`
 *              —— **宁可说不知道，也不要用一个已知是错的**。
 */
export function resolveContentLang(
  stored: string | null | undefined,
  sample: string,
): ResolvedContentLang {
  const label = normalizeLang(stored) || null;
  if (!label) return { lang: null, corrected: false };

  const fromText = dominantScript(sample);
  const fromLabel = scriptOfLang(label);
  // 有一边判不出来就没得比 —— 信标签，别自作聪明
  if (!fromText || !fromLabel || fromText === fromLabel) {
    return { lang: label, corrected: false };
  }

  // 落库前归一成码（D42）：`langOfScript` 给的是 `zh` 这种主子标签
  const guess = langOfScript(fromText);
  return { lang: guess ? normalizeLang(guess) : null, corrected: true };
}

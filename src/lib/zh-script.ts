import { normalizeLang, type LangPrefs } from "@/lib/lang";
import type { TranscriptSegment } from "@/lib/types";
import { EXTRA, SIMP, TRAD } from "./zh-hans-table";

// D50 —— 字幕字形（简体/繁体）跟着用户的语言走。
//
// **这一层为什么非有不可**：转写是"听人说话"，而**语音里没有字形**。
// 同一句上海话，写成「學說上海話」还是「学说上海话」，全由动笔的那一方（Gemini）自己挑，
// 而我们从来没告诉过它挑哪一种 —— 2026-08-07 真机上就撞了：母语设的是简体中文，
// 一支普通话视频的字幕整篇是繁体，点了译文=简体中文，模型认为"中文翻中文"无事可做，
// 原样抄回来（只把半角逗号改成全角），于是译文也是繁体。
//
// 提示词那边也一并定死了（`gemini-youtube.ts` 要求中文写简体），但**那只是概率不是契约**
// （整个 M2a 的教训就是这句）。真正的保证在这一层：**读侧转换**。
//
// **为什么放读侧而不是写侧**（照抄 D42 `normalizeLang` 的成例）：
//   ⑴ `transcript_cache` 是**跨用户共享**的，按 content_key 存一份，没有字形维度 ——
//      按某个人的偏好改写它，等于替下一个人做主；
//   ⑵ 放读侧，**库里已经存着的旧字幕不用动，也立刻显示正确**（他那支视频就是这样修好的，
//      不用重新花钱转写、不用删缓存）；
//   ⑶ 他哪天把母语改成繁体，下一次打开就跟着变，不需要回头刷任何数据。
//
// **纯函数层**（D24）：客户端也要用它，一行服务端依赖都不许有。

/** 汉字的两套字形。语言码里的 `Hans` / `Hant` 子标签 */
export type HanScript = "Hans" | "Hant";

// 表是生成的（`swift scripts/gen-zh-hans-table.swift`），两条等长字符串按下标对应。
// 长度不等就是生成器出了岔子 —— **当场炸**，别默默错位把「學」翻成别的字。
if (TRAD.length !== SIMP.length) {
  throw new Error(`zh-hans-table 坏了：TRAD ${TRAD.length} 条 / SIMP ${SIMP.length} 条，对不上`);
}

const T2S = new Map<string, string>();
for (let i = 0; i < TRAD.length; i++) T2S.set(TRAD[i], SIMP[i]);
for (const [t, s] of Object.entries(EXTRA)) T2S.set(t, s);

/**
 * 这门语言用哪套字形。**不是中文就返回 null**（"这件事跟你无关"）。
 *
 * 光秃秃的 `zh` 由 `normalizeLang` 归成 `zh-Hans` —— 那是 D42 定的默认，不在这儿翻案。
 */
export function hanScriptOf(lang: string | null | undefined): HanScript | null {
  const code = normalizeLang(lang);
  if (!code.startsWith("zh")) return null;
  return code.endsWith("Hant") ? "Hant" : "Hans";
}

/**
 * 字幕该写成哪套字形。**创始人 2026-08-07 拍板：跟着母语走**，不新增开关
 * （语言选择器里本来就分「简体中文 / 繁體中文」两项，字形信息已经在母语里了）。
 *
 * 多加的一条 `targetLang` 优先，是那句拍板的自然推广：母语英语、**在学简体中文**的人
 * 看中文视频，字幕显然该按他在学的那一套写，而不是按"母语不是中文 → 不管"落空。
 * 三个语言的关系自动决定行为，这正是 D42 的写法。
 */
export function captionScriptFor(prefs: LangPrefs): HanScript | null {
  return hanScriptOf(prefs.targetLang) ?? hanScriptOf(prefs.nativeLang);
}

/** 文本里有没有繁体独有字。用来判断"这份字幕是哪套字形"，不必去问 AI */
export function hasTraditional(text: string): boolean {
  for (const ch of text) if (T2S.has(ch)) return true;
  return false;
}

const HAN = /\p{Script=Han}/u;
/** 假名 + 谚文。日文韩文也写汉字，光数汉字会把它们认成中文 */
const NOT_CHINESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * 这段文字**看着像不像中文**。
 *
 * 用在 `content_lang` 空着的时候 —— YouTube 那条转写路（`gemini-youtube`）从来不报语言，
 * 所以库里那一列多半是 null，"要不要翻译"的判断没法只靠它。
 * 这是个便宜的兜底，不是语言识别：**先排除日文韩文**（它们也写汉字），
 * 再看汉字占没占到一半。判不准就返回 false —— 宁可多花一次翻译，也不要把该翻的当成不用翻。
 */
export function looksChinese(text: string): boolean {
  if (NOT_CHINESE.test(text)) return false;
  let han = 0;
  let letters = 0;
  for (const ch of text) {
    if (/\s|\p{P}|\p{S}|\p{N}/u.test(ch)) continue;
    letters++;
    if (HAN.test(ch)) han++;
  }
  return letters > 0 && han / letters > 0.5;
}

/**
 * 繁体 → 简体。**没有一个字要换就原样返回那个字符串**（同一个引用），
 * 好让上层的 `useMemo` / React 比较不会因为"转了个寂寞"而白重渲染一遍字幕。
 */
export function toSimplified(text: string): string {
  if (!hasTraditional(text)) return text;
  let out = "";
  for (const ch of text) out += T2S.get(ch) ?? ch;
  return out;
}

/**
 * 把一段文字调成 `script` 那套字形。
 *
 * **⚠️ `Hant` 是有意的空操作，不是漏写的分支。** 简→繁是**一对多**：128 个简体字
 * 对应多个繁体字（发→髮/發、干→乾/幹、里→裡/里、台→臺/檯/颱…），实测 ICU 为此带了
 * **42336 条**双字词级规则。只拿字表硬转，必然写出「頭发」「幹了」这种错字 ——
 * 对一个繁体母语的人来说，**那比看到简体更糟**。所以这个方向宁可什么都不做：
 * 内容本来是繁体的（这类内容本来就多）他看到的就是繁体，本来是简体的他看到简体。
 * 真要做，把那 42336 条一起导出来即可，办法都在 `scripts/gen-zh-hans-table.swift` 里写着了。
 */
export function conformHan(text: string, script: HanScript | null): string {
  return script === "Hans" ? toSimplified(text) : text;
}

/**
 * 整条字幕调字形。**一句都没变就原样返回那个数组**（同一个引用）——
 * 非中文内容、以及本来就是简体的内容，这里是纯扫描零分配，下游的 `useMemo` 也不会被打断。
 */
export function conformSegments<T extends TranscriptSegment>(
  segments: T[],
  script: HanScript | null,
): T[] {
  if (script !== "Hans" || segments.length === 0) return segments;
  let changed = false;
  const out = segments.map((seg) => {
    const text = toSimplified(seg.text);
    if (text === seg.text) return seg;
    changed = true;
    return { ...seg, text };
  });
  return changed ? out : segments;
}

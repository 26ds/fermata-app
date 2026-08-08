import { normalizeLang, type LangPrefs } from "@/lib/lang";

// D50 —— 中文字幕的字形（简体/繁体）跟着用户的语言走。**这一份只管"该是哪套"，
// 不管"怎么转"** —— 转换在 `zh-convert.ts`（那份带 1MB 词库，服务端专用）。
//
// **这一层为什么非有不可**：转写是"听人说话"，而**语音里没有字形**。
// 同一句上海话，写成「學說上海話」还是「学说上海话」，全由动笔的那一方（Gemini）自己挑，
// 而我们从来没告诉过它挑哪一种 —— 2026-08-07 真机上就撞了：母语设的是简体中文，
// 一支普通话视频的字幕整篇是繁体，点了译文=简体中文，模型认为"中文翻中文"无事可做，
// 原样抄回来（只把半角逗号改成全角），于是译文也是繁体。
//
// 转写那一层**故意没管字形**（理由写在 `gemini-youtube.ts` 的 PROMPT 上方）——
// 那份字幕是跨用户共享的，替所有人定死一套字形不是转写该做的决定。
// 真正的保证在**读侧转换**。
//
// **为什么放读侧而不是写侧**（照抄 D42 `normalizeLang` 的成例）：
//   ⑴ `transcript_cache` 是**跨用户共享**的，按 content_key 存一份，没有字形维度 ——
//      按某个人的偏好改写它，等于替下一个人做主；
//   ⑵ 放读侧，**库里已经存着的旧字幕不用动，也立刻显示正确**（他那支视频就是这样修好的，
//      不用重新花钱转写、不用删缓存）；
//   ⑶ 他哪天把母语改成繁体，下一次打开就跟着变，不需要回头刷任何数据。
//
// **纯函数层**（D24）：这一份不碰词库也不碰服务端依赖，客户端 import 它是安全的。

/** 汉字的两套字形。语言码里的 `Hans` / `Hant` 子标签 */
export type HanScript = "Hans" | "Hant";

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
 *
 * 返回 `null` = 他跟中文没关系，**别动内容**。
 */
export function captionScriptFor(prefs: LangPrefs): HanScript | null {
  return hanScriptOf(prefs.targetLang) ?? hanScriptOf(prefs.nativeLang);
}

/**
 * 屏幕上**实际**是哪套字形。母语跟中文无关时不转，那他看到的就是库里存的那套。
 *
 * 译文栏要不要给他译文，比的是**这个**，不是库里存的那套 —— 他那支视频库里是繁体、
 * 屏幕上是简体，两者不分开就会判错。
 */
export function displayedHanScript(prefs: LangPrefs, storedScript: HanScript): HanScript {
  return captionScriptFor(prefs) ?? storedScript;
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

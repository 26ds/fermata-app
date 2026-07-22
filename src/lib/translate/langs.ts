// M2.9 双语字幕 —— 目标语言表。
//
// **客户端安全**：这只是一张静态表，不碰任何服务端依赖（D24）。
// 服务端（gemini-translate）用 `name` 拼 prompt；客户端选择器用 `label` 显示、用 `code` 存 localStorage。
// 一处定义，两边共用，别让选择器和 prompt 各写一份对不上。

export interface TargetLang {
  /** BCP-47 简码，存进缓存主键与 localStorage */
  code: string;
  /** 英文名，塞进给模型的 prompt（"translate into X"） */
  name: string;
  /** 母语写法，给用户在选择器里看 */
  label: string;
}

export const TARGET_LANGS: TargetLang[] = [
  { code: "zh-Hans", name: "Simplified Chinese", label: "简体中文" },
  { code: "zh-Hant", name: "Traditional Chinese", label: "繁體中文" },
  { code: "en", name: "English", label: "English" },
  { code: "ja", name: "Japanese", label: "日本語" },
  { code: "ko", name: "Korean", label: "한국어" },
  { code: "es", name: "Spanish", label: "Español" },
  { code: "fr", name: "French", label: "Français" },
  { code: "de", name: "German", label: "Deutsch" },
  { code: "ru", name: "Russian", label: "Русский" },
  { code: "pt", name: "Portuguese", label: "Português" },
  { code: "it", name: "Italian", label: "Italiano" },
  { code: "ar", name: "Arabic", label: "العربية" },
  { code: "hi", name: "Hindi", label: "हिन्दी" },
  { code: "th", name: "Thai", label: "ไทย" },
  { code: "vi", name: "Vietnamese", label: "Tiếng Việt" },
];

const BY_CODE = new Map(TARGET_LANGS.map((l) => [l.code, l]));

/** prompt 里要的英文名；未知码就原样返回（模型也认得多数 ISO 码） */
export function langName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

export function isSupportedLang(code: string): boolean {
  return BY_CODE.has(code);
}

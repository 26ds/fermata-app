import { cookies, headers } from "next/headers";
import { effectiveUiLang, readLangPrefs } from "@/lib/lang";
import { makeT, matchUiLocale, resolveUiLocale, FALLBACK_UI_LOCALE } from "@/lib/copy";
import { UI_LANG_COOKIE } from "@/lib/ui-lang-shared";

// M3.9 片 b —— **服务端**决定这一次渲染用哪门界面语言。
//
// ⚠️ 这个文件读 `next/headers`，**只能在服务端 import**。文案表本身
// （`src/lib/copy/`）是纯的、客户端也能用，别把这两者混在一起（D24）。
//
// ── 为什么真身在数据库、却还要一份 cookie 镜像 ──────────────────────────
// `loading.tsx` 骨架屏**在任何取数之前就渲染**（那正是它存在的意义：让跳转立刻发生）。
// 它等不到数据库。根布局要在 `<html lang>` 上写值，同样不该为此多查一次库。
// cookie 让这两处**零等待**拿到语言。
//
// **冲突时数据库赢** —— cookie 只是缓存：`/api/settings` 的 GET 会顺带纠偏，
// PUT 会当场重写。cookie 被清掉也不会白屏，只是回落链走到底。

// cookie 的名字和寿命搬去了 `lib/ui-lang-shared.ts` —— 那边零依赖，
// 客户端的「中 / EN」按钮要直接写这个 cookie（本文件 import 了 next/headers，进不了浏览器）。
// 这里再导出一次，既有的 import 路径不用动。
export { UI_LANG_COOKIE, UI_LANG_COOKIE_MAX_AGE } from "@/lib/ui-lang-shared";

/**
 * 从 `Accept-Language` 里挑第一门**我们真有文案**的语言。
 *
 * 注意是"第一门有文案的"，不是"第一门"：`th,en;q=0.9` 的用户，
 * 第一门泰语我们没有，但他明确说了也读英文 —— 直接落 `en` 才对，
 * 而不是因为第一条不认识就走兜底（虽然结果碰巧一样，但换成 `th,ja;q=0.9` 就不一样了）。
 */
export function pickFromAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => part.split(";")[0]!.trim())
    .filter(Boolean);
  for (const tag of tags) {
    const hit = matchUiLocale(tag);
    if (hit) return hit;
  }
  return null;
}

/**
 * 这一次渲染用哪门界面语言：**cookie → Accept-Language → 英文**。
 *
 * 这里读设备语言是**对的**，和 D42 修订①禁止的那件事不是一回事：
 * 那条禁的是"拿设备语言**冒充这个人的母语存进他的档案**"；
 * 这里只是决定这一屏用什么语言画，**不写任何人的档案**。
 */
export async function getUiLang(): Promise<string> {
  const fromCookie = (await cookies()).get(UI_LANG_COOKIE)?.value;
  const cookieHit = matchUiLocale(fromCookie);
  if (cookieHit) return cookieHit;

  const fromHeader = pickFromAcceptLanguage((await headers()).get("accept-language"));
  return fromHeader ?? FALLBACK_UI_LOCALE;
}

/**
 * 一坨 `user_settings.settings` → 该往 cookie 里写什么。
 * `uiLang` 空就跟母语走（D42：默认跟 native_lang，但可单独覆盖）。
 */
export function uiLocaleFromSettings(settings: Record<string, unknown> | null | undefined): string {
  return resolveUiLocale(effectiveUiLang(readLangPrefs(settings ?? {})));
}

/**
 * 服务端组件 / 页面里取 `t` 的快捷方式（**不经过 React**，所以 server component 用得了）。
 *
 * 每次调用会再读一遍 cookie。那是内存里的一次字符串解析，比把 `t` 从根布局
 * 一层层往下传（每个 server page 都要多一个 prop）便宜得多，也不会漏传。
 */
export async function getT() {
  return makeT(await getUiLang());
}

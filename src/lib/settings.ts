import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LANG_PREFS, readLangPrefs, type LangPrefs } from "@/lib/lang";
import { DEFAULT_PLAY_PREFS, readAutoScan, readPlayPrefs, type PlayPrefs } from "@/lib/play-prefs";

// M3.7 —— 服务端读用户设置（`user_settings.settings`，迁移 0006 的表，**零新迁移**）。
//
// 三个语言（D42）与聊天流光颜色（M3 Phase-2）共用这一坨 jsonb，PUT 是浅合并，
// 改一个键不冲掉别的 —— 见 `/api/settings`。
//
// 这里只读不写：页面（server component）与各条 AI 路由都要知道"该用哪门语言"，
// 每处各查一次太散，统一从这个口出。

/** 整坨设置。表还没建 / 这人还没存过 → 空对象，不是错误 */
export async function getSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return {};
  const s = (data as { settings: Record<string, unknown> | null }).settings;
  return s ?? {};
}

/**
 * 只要三个语言。**取不到就返回"什么都不知道"**（`DEFAULT_LANG_PREFS`），
 * 不塞任何默认语言进去 —— D42 的整条红线就是不许假设内容是英文、用户是中文。
 * 母语真空着的时候由 `<LangBootstrap />` 拿 navigator.language 补，那是浏览器实测的，不是猜的。
 */
export async function getLangPrefs(
  supabase: SupabaseClient,
  userId: string,
): Promise<LangPrefs> {
  try {
    return readLangPrefs(await getSettings(supabase, userId));
  } catch {
    return DEFAULT_LANG_PREFS;
  }
}

/**
 * 观看页要的两坨偏好，**一次查询取齐**（三个语言 + 倍速/跳跃步长）。
 * 分两个函数各查一次是白多一趟往返 —— 它们本来就存在同一行 jsonb 里。
 */
export async function getWatchPrefs(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ lang: LangPrefs; play: PlayPrefs; autoScan: boolean }> {
  try {
    const settings = await getSettings(supabase, userId);
    return {
      lang: readLangPrefs(settings),
      play: readPlayPrefs(settings),
      autoScan: readAutoScan(settings),
    };
  } catch {
    // 取不到设置就当自动扫描是关的 —— **默认必须偏向"不花钱"**（D45）
    return { lang: DEFAULT_LANG_PREFS, play: DEFAULT_PLAY_PREFS, autoScan: false };
  }
}

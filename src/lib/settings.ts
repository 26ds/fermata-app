import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LANG_PREFS, readLangPrefs, type LangPrefs } from "@/lib/lang";
import { DEFAULT_PLAY_PREFS, readAutoScan, readPlayPrefs, type PlayPrefs } from "@/lib/play-prefs";
import { DEFAULT_WATCH_LAYOUT, readWatchLayout, type WatchLayout } from "@/lib/watch-layout";

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
): Promise<{ lang: LangPrefs; play: PlayPrefs; autoScan: boolean; atHintSeen: boolean; layout: WatchLayout }> {
  try {
    const settings = await getSettings(supabase, userId);
    return {
      lang: readLangPrefs(settings),
      play: readPlayPrefs(settings),
      autoScan: readAutoScan(settings),
      // M3.15 片 d（D69）：`@` 那张单子自动弹过一次了吗。**这一条和上面那个默认方向相反**：
      // 自动扫描默认关（怕花钱），这一句默认"没弹过"（它不花钱，而创始人点名要「让用户知道这个功能」）
      atHintSeen: settings.atHintSeen === true,
      // M3.15 片 g（D67）：宽屏选的是哪种布局。跟人走（换设备还在），同一次查询取齐 —— 首屏就按它排，不先闪一下默认那种
      layout: readWatchLayout(settings),
    };
  } catch {
    // 取不到设置就当自动扫描是关的 —— **默认必须偏向"不花钱"**（D45）
    return { lang: DEFAULT_LANG_PREFS, play: DEFAULT_PLAY_PREFS, autoScan: false, atHintSeen: false, layout: DEFAULT_WATCH_LAYOUT };
  }
}

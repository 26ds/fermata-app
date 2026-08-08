import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslatedSegment } from "./gemini-translate";
import { MAX_SEGMENTS } from "@/lib/captions";

// M2.9 跨用户「译文」缓存。译文对 (同一支内容, 同一种目标语言) 是一样的，跟谁看无关 ——
// 按 (content_key, target_lang) 去重，第一个翻的人填，后面的人（含手机）白拿。
// 和字幕缓存分开一张表（创始人要求）：看同一视频概率大、但同一视频同一语言概率小得多。
// 只存公共字幕的机器翻译，不碰个人数据。表结构见 supabase/migrations/0005_translation_cache.sql。

/** 命中就返回现成译文（零成本零延迟）；没有就 null，照常去翻 */
export async function getCachedTranslation(
  supabase: SupabaseClient,
  key: string,
  targetLang: string,
): Promise<{ translations: TranslatedSegment[]; sourceLang: string | null } | null> {
  const { data, error } = await supabase
    .from("translation_cache")
    .select("translations, source_lang")
    .eq("content_key", key)
    .eq("target_lang", targetLang)
    .maybeSingle();
  // 表还没建（迁移没跑）时别炸主流程，当作没命中，退回去自己翻
  if (error || !data) return null;
  const translations = Array.isArray(data.translations)
    ? (data.translations as TranslatedSegment[])
    : [];
  if (translations.length === 0) return null;
  return { translations, sourceLang: (data.source_lang as string | null) ?? null };
}

/**
 * 把**翻完整**的译文写回缓存，给后来人复用。
 * 只在 `complete` 时写 —— 半截的写进去会让下一个打开的人看到缺行。
 * 写失败（表没建 / 权限）静默吞掉：缓存是加分项，绝不能挡住这一次已经给到用户的译文。
 */
export async function putCachedTranslation(
  supabase: SupabaseClient,
  key: string,
  targetLang: string,
  translations: TranslatedSegment[],
  sourceLang?: string | null,
): Promise<void> {
  if (!key || translations.length === 0) return;
  try {
    await supabase.from("translation_cache").upsert(
      {
        content_key: key,
        target_lang: targetLang,
        translations: translations.slice(0, MAX_SEGMENTS),
        source_lang: sourceLang ?? null,
      },
      { onConflict: "content_key,target_lang" },
    );
  } catch {
    /* 缓存写不进不影响这一次的译文已经给到用户 */
  }
}

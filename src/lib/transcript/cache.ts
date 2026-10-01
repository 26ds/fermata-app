import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptSegment } from "@/lib/types";
import { MAX_SEGMENTS } from "@/lib/captions";
import { sharedCacheWriter } from "@/lib/supabase/cache-writer";

// M2 跨用户字幕缓存（D31）。字幕对同一支内容是一样的，跟谁看无关 ——
// 按 sources.external_id 去重，同一支全网只转一次，第二个人打开直接白拿。
// 只存公共字幕，不碰个人数据。表结构见 supabase/migrations/0004_transcript_cache.sql。

/** 命中就返回现成字幕（零成本零延迟）；没有就 null，照常去转 */
export async function getCachedTranscript(
  supabase: SupabaseClient,
  key: string,
): Promise<{ segments: TranscriptSegment[]; lang: string | null } | null> {
  const { data, error } = await supabase
    .from("transcript_cache")
    .select("segments, lang")
    .eq("content_key", key)
    .maybeSingle();
  // 表还没建（迁移没跑）时别炸整条转写链，当作没命中，退回去自己转
  if (error || !data) return null;
  const segments = Array.isArray(data.segments) ? (data.segments as TranscriptSegment[]) : [];
  if (segments.length === 0) return null;
  return { segments, lang: (data.lang as string | null) ?? null };
}

/**
 * 把**转完整**的字幕写回缓存，给后来人复用。
 * 只在 `complete` 时写 —— 半截的（partial）写进去会坑到下一个打开的人。
 * 写失败（表没建 / 权限）静默吞掉：缓存是加分项，绝不能让它挡住主流程。
 * 写走 `sharedCacheWriter`（服务端 service role）—— 迁移 0014 起登录用户对这张表只剩读。
 */
export async function putCachedTranscript(
  supabase: SupabaseClient,
  key: string,
  kind: string,
  segments: TranscriptSegment[],
  lang?: string | null,
): Promise<void> {
  if (!key || segments.length === 0) return;
  try {
    await sharedCacheWriter(supabase)
      .from("transcript_cache")
      .upsert(
        { content_key: key, kind, segments: segments.slice(0, MAX_SEGMENTS), lang: lang ?? null },
        { onConflict: "content_key" },
      );
  } catch {
    /* 缓存写不进不影响这一次的字幕已经给到用户 */
  }
}

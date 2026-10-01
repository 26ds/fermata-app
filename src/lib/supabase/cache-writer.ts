import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./config";

// 2026-09-26（公开仓库那一片，创始人选 A）—— 三张**全站共享**的缓存表
// （transcript_cache / translation_cache / word_senses）改成**只有服务器能写**。
//
// 以前这三张表的 RLS 是「任何登录的人都能 insert + update 任意一行」：谁用 Google 登进来，
// 拿浏览器里本来就公开的 anon key 直接调 Supabase，就能把别人也在用的字幕 / 译文 / 词义改掉。
// 迁移 0014 收掉这两条写策略、只留读；写一律走这里的 service role 客户端（它绕过 RLS）。
//
// ⚠️ service role 能绕过**所有** RLS —— 这个客户端**只许用来写这三张公共缓存表**。
// 碰用户自己的数据一律用 `server.ts` 那个带会话的客户端。
//
// 没配 `SUPABASE_SERVICE_ROLE`（本地开发 / Vercel 还没加）时退回调用方传进来的会话客户端：
// 迁移 0014 跑之前照旧写得进去；跑之后写不进去、静默吞掉 —— 缓存是省钱的，不是能不能用的前提。
let writer: SupabaseClient | null | undefined;

export function sharedCacheWriter(fallback: SupabaseClient): SupabaseClient {
  if (writer === undefined) {
    const key = process.env.SUPABASE_SERVICE_ROLE;
    writer =
      supabaseUrl && key
        ? createClient(supabaseUrl, key, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          })
        : null;
    if (!writer) {
      console.warn("[cache] 没配 SUPABASE_SERVICE_ROLE：共享缓存退回用户会话写（迁移 0014 跑过之后会写不进去）");
    }
  }
  return writer ?? fallback;
}

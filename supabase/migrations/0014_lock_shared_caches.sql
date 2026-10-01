-- Fermata 0014 — 三张共享缓存改成「只有服务器能写」（2026-09-26，公开仓库那一片，创始人选 A）
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 Run。**只删写策略、一行数据都不动**，跑第二遍也安全。
--
-- ⚠️ 顺序：**先**在 Vercel 加好 `SUPABASE_SERVICE_ROLE`、新代码也已经上线，**再**跑这一段。
--    顺序反了也不会坏：只是那之前缓存写不进去，每次都要重新转写 / 翻译 / 查词（多花钱、慢一点）。
--
-- 为什么：0004 / 0005 / 0008 给 authenticated 开了 insert + update（`using (true) with check (true)`），
-- 任何登录用户都能拿浏览器里本来就公开的 anon key，直接改掉别人也在用的字幕、译文、词义。
-- 改完之后：登录用户只能**读**这三张表；**写**只走服务端的 service role（它绕过 RLS），
-- 见 `src/lib/supabase/cache-writer.ts`。读策略（"… read"）一条不动。
--
-- ⚠️ 0004 / 0005 / 0008 是能重跑的，重跑会把写策略**加回来** —— 重跑过它们，就再跑一遍本文件。

drop policy if exists "transcript_cache insert"  on public.transcript_cache;
drop policy if exists "transcript_cache update"  on public.transcript_cache;

drop policy if exists "translation_cache insert" on public.translation_cache;
drop policy if exists "translation_cache update" on public.translation_cache;

drop policy if exists "word_senses insert"       on public.word_senses;
drop policy if exists "word_senses update"       on public.word_senses;

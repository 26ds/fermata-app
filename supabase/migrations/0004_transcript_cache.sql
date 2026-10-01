-- Fermata 0004 — 跨用户字幕缓存（创始人 2026-07-20 拍板，见 WORKORDER D31）
-- ⚠️ 2026-09-26 起：下面的 insert / update 写策略由 0014 收掉了（共享缓存只有服务器能写）。重跑本文件后，务必再跑一遍 0014。
-- 用法：在 Supabase Dashboard → SQL Editor 里整段粘贴运行一次。跑第二遍也安全。
--
-- 为什么值得单开一张表：字幕对同一支内容是**一样的**，跟谁看无关。
-- 按内容 ID（YouTube = videoId，播客 = feedUrl#guid，都存在 sources.external_id）去重，
-- 同一支视频/节目**全网只转一次**，第二个人打开直接白拿 —— 省的是转写算力那笔钱，
-- 不是存储（字幕是纯文本，一小时约 100 KB）。
--
-- 关键：这里**只存公共内容的字幕**，绝不含任何个人数据（笔记、打断点、进度都在别的表，锁在本人行上）。
-- 所以这张表是**共享**的：任何登录用户都能读、能写。

create table if not exists public.transcript_cache (
  -- 内容的规范身份：sources.external_id（youtube=videoId，podcast=feedUrl#guid，网页导入=页面URL）
  content_key text primary key,
  kind        text not null,
  -- TranscriptSegment[]：{ start, end, text }，与 sources.transcript 同形
  segments    jsonb not null,
  -- Whisper/转写检测到的语言（D10 的口子），可空
  lang        text,
  created_at  timestamptz not null default now()
);

comment on table public.transcript_cache is '跨用户字幕缓存：同一支内容只转一次，全网复用。只存公共字幕，无个人数据（D31）';
comment on column public.transcript_cache.content_key is 'sources.external_id：youtube=videoId / podcast=feedUrl#guid / 网页=页面URL';

alter table public.transcript_cache enable row level security;

-- 公共字幕：任何登录用户都能读、能写（写=转写完或粘贴完回填）。不含个人数据，共享无隐私顾虑。
drop policy if exists "transcript_cache read"   on public.transcript_cache;
drop policy if exists "transcript_cache insert" on public.transcript_cache;
drop policy if exists "transcript_cache update" on public.transcript_cache;
create policy "transcript_cache read"   on public.transcript_cache for select to authenticated using (true);
create policy "transcript_cache insert" on public.transcript_cache for insert to authenticated with check (true);
create policy "transcript_cache update" on public.transcript_cache for update to authenticated using (true) with check (true);

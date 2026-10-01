-- Fermata 0005 — 跨用户「译文」缓存（M2.9 双语字幕，见 plans/M2.9-plan.md）
-- ⚠️ 2026-09-26 起：下面的 insert / update 写策略由 0014 收掉了（共享缓存只有服务器能写）。重跑本文件后，务必再跑一遍 0014。
-- 用法：在 Supabase Dashboard → SQL Editor 里整段粘贴运行一次。跑第二遍也安全。
--
-- 为什么和字幕缓存（0004）分开一张表（创始人明确要求）：
--   字幕对同一支内容是一样的 → 看同一个视频的概率很大 → transcript_cache 第二次命中率高；
--   但「同一支内容 + 同一种目标语言」的概率小得多 → 译文按 (内容, 语言) 各缓存一份，各自填。
--   译文是在**已缓存好的字幕**上跑一趟便宜的翻译得来的，跟转写是两条独立通路。
--
-- 关键：这里**只存公共字幕的机器翻译**，绝不含任何个人数据（笔记、打断点、进度在别的表，锁在本人行上）。
-- 所以这张表和 0004 一样是**共享**的：任何登录用户都能读、能写（第一个翻的人填，后面的人白拿）。

create table if not exists public.translation_cache (
  -- 内容的规范身份：sources.external_id（youtube=videoId / podcast=feedUrl#guid / 网页=页面URL），与 transcript_cache 同一把钥匙
  content_key text not null,
  -- 目标语言 BCP-47 简码：en / ja / ko / es / fr / de / ru / pt / zh-Hans / zh-Hant …
  target_lang text not null,
  -- 与该内容的字幕**按下标对齐**的译文数组：[{ i, start, text }]
  --   i     = 字幕段下标（对齐 sources.transcript / transcript_cache.segments）
  --   start = 那段的起点秒（存着，万一字幕变了能按时间校正/发现错位）
  --   text  = 译文
  translations jsonb not null,
  -- 检测到的原文语言（Whisper/字幕自带），可空 —— 用来判断「目标==原文就不用翻」
  source_lang text,
  created_at  timestamptz not null default now(),
  primary key (content_key, target_lang)
);

comment on table public.translation_cache is '跨用户译文缓存：(内容, 目标语言) 只翻一次，全网复用。只存公共字幕的机器翻译，无个人数据（M2.9）';
comment on column public.translation_cache.content_key is 'sources.external_id，与 transcript_cache 同键';
comment on column public.translation_cache.translations is '对齐字幕下标的译文数组 [{ i, start, text }]';

alter table public.translation_cache enable row level security;

-- 公共译文：任何登录用户都能读、能写。不含个人数据，共享无隐私顾虑（同 0004 纪律）。
drop policy if exists "translation_cache read"   on public.translation_cache;
drop policy if exists "translation_cache insert" on public.translation_cache;
drop policy if exists "translation_cache update" on public.translation_cache;
create policy "translation_cache read"   on public.translation_cache for select to authenticated using (true);
create policy "translation_cache insert" on public.translation_cache for insert to authenticated with check (true);
create policy "translation_cache update" on public.translation_cache for update to authenticated using (true) with check (true);

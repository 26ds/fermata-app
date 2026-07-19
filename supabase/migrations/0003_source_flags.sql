-- Fermata 0003 — 内容源的置顶与收藏（创始人 2026-07-19 要求，见 WORKORDER D16）
-- 用法：在 Supabase Dashboard → SQL Editor 里整段粘贴运行一次。跑第二遍也安全。
--
-- 用时间戳而不是布尔值：既能表达"是否"，又自带"什么时候" ——
-- 置顶多条时按最近置顶的排前面，不用再加一个排序字段。

alter table sources
  add column if not exists pinned_at timestamptz,
  add column if not exists favorited_at timestamptz;

comment on column sources.pinned_at is '置顶时间；null = 未置顶。列表按它倒序排在最前';
comment on column sources.favorited_at is '收藏时间；null = 未收藏。/watch?tab=favorites 只看这些';

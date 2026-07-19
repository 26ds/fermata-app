-- Fermata 0002 — 记住每条内容"看到第几秒"（创始人 2026-07-19 要求）
-- 用法：在 Supabase Dashboard → SQL Editor 里整段粘贴运行一次。
-- 跑第二遍也安全（if not exists）。

alter table sources
  add column if not exists last_position_s numeric;

comment on column sources.last_position_s is
  '上次退出前播放到的秒数。列表里的 watched to 就是它。';

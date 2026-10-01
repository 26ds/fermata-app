-- Fermata 0008 — 悬浮词卡（M3.11，见 plans/M3.11-plan.md）
-- ⚠️ 2026-09-26 起：下面的 insert / update 写策略由 0014 收掉了（共享缓存只有服务器能写）。重跑本文件后，务必再跑一遍 0014。
-- 用法：在 Supabase Dashboard → SQL Editor 里整段粘贴运行一次。跑第二遍也安全。
--
-- 这一次迁移干两件事：
--   ① 新表 word_senses —— 「某个词在某门母语里的常用义项」的**跨用户共享缓存**；
--   ② atoms 加一列 gloss_pos —— 那条词**在它自己那句话里**的词性。
--
-- 为什么义项要单独一张共享表，而不是塞进 atoms：
--   「because 有哪三个常用义项」这件事**和是谁收的、在哪个视频里收的毫无关系** ——
--   全世界只该算一次。而「它在这一句里是什么意思」才是每条 atom 各自的。
--   两者混在一起，就会每收一个 because 都重新算一遍它的常用义项，白花钱。
--   这套共享缓存的路子本项目已经在跑：0004 字幕缓存、0005 译文缓存，同一套 RLS 纪律。
--
-- 关键：**这张表里没有任何个人数据** —— 就是词典条目本身，所以共享无隐私顾虑。

create table if not exists public.word_senses (
  -- 用户划下来的原文，一字不差（可能是一个词，也可能是 "hang in there" 这样一整段）
  term text not null,
  -- 这个词是什么语言（内容语言，D42：显式写值，绝不许靠数据库默认值）
  content_lang text not null,
  -- 义项用哪门语言写的（= 生成当时的母语）。**换母语 = 换一把钥匙**，
  -- 所以「改了母语，解释跟着变」对这半边是自动的：查不到就按新语言生成一份，各存各的
  support_lang text not null,
  -- [{ pos, gloss }] —— 最多三条最常用义项。pos = 词性（也用 support_lang 写，
  -- 「连词」对中文母语、「conjunction」对英文母语），gloss = 一句话意思
  senses jsonb not null,
  created_at timestamptz not null default now(),
  primary key (term, content_lang, support_lang)
);

comment on table public.word_senses is '跨用户词义缓存：(词, 内容语言, 解释语言) 只查一次，全网复用。无个人数据（M3.11）';
comment on column public.word_senses.senses is '[{ pos, gloss }]，最多 3 条最常用义项，pos 与 gloss 都用 support_lang 写';

alter table public.word_senses enable row level security;

-- 公共词义：任何登录用户都能读、能写。第一个查的人填，后面的人白拿（同 0004 / 0005 纪律）。
drop policy if exists "word_senses read"   on public.word_senses;
drop policy if exists "word_senses insert" on public.word_senses;
drop policy if exists "word_senses update" on public.word_senses;
create policy "word_senses read"   on public.word_senses for select to authenticated using (true);
create policy "word_senses insert" on public.word_senses for insert to authenticated with check (true);
create policy "word_senses update" on public.word_senses for update to authenticated using (true) with check (true);

-- ── atoms：当前语境下的词性 ──────────────────────────────────────
-- 单开一列，**不塞进 gloss 字符串里**：一个字段承担两种含义，早晚要还
-- （本项目已经在别处吃过这个亏）。空 = 老数据，或这次没判出来。
alter table public.atoms add column if not exists gloss_pos text;
comment on column public.atoms.gloss_pos is '这条词在它自己那句话里的词性，用 support_lang 写（M3.11）';

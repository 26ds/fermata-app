-- 0012 — M3.15 片 c0「互动记录」（D71）
--
-- 用法：Supabase → 项目 nlangqpdcjdmqkslfjks → SQL Editor → 整段粘贴 Run。
-- **跑第二遍也安全**：建表 / 建索引都带 `if not exists`，策略先 drop 再建。
-- 个人数据：RLS 只许本人读写，同 chats / interrupts。
--
-- 号在 2026-09-12 计划变更那一刻就占死了（plans/README.md 目录表上写着）。
-- 0009 预定给 M3.8 `folders`、0010 给 M2.7 `structure_cache` —— 那两片还没做，号不许被拿走。
--
-- **为什么是新表，不是往 0011 的 `sources.watched_ranges` 里写**：
-- `watched_ranges` 只记得「哪些区间看过」，记不了「怎么跳的、停了多久、先跳后问」的**顺序**；
-- 而「看了几遍」也得从一段段播放里数出来。所以这张表是**唯一的真相**，
-- 捕获轴的深浅和互动记录都从它算。`watched_ranges` 这一片不写、也不删（迁移只加不删）。

create table if not exists public.watch_events (
  -- 浏览器生成：同一批重发（网络抖了、keepalive 又发一次）不会存两遍
  id uuid primary key,
  user_id uuid references auth.users not null,
  source_id uuid not null references public.sources on delete cascade,
  -- 同一次打开观看页 = 同一个 visit（界面上的「9月11日 14:02 这一次」）。
  -- **不叫 session**：0001 里已经有一张没用上的 `public.sessions`，别撞名
  visit_id uuid not null,
  seq int not null,                  -- 这一次里的第几件事（同一毫秒也排得出先后）
  at timestamptz not null,           -- 这件事开始的时刻（浏览器时钟，只用来显示和分组）
  kind text not null,                -- play / pause / seek / leave / ask / capture
  from_s real,
  to_s real,
  dur_ms int,                        -- 真实经过的毫秒：播放段 / 停住 / 离开
  rate real,                         -- 播放段的倍速
  via text,                          -- seek 是怎么来的：player / at_link / back / dots / dots_nav / caption / step / record / card
  interrupt_id uuid references public.interrupts on delete cascade,  -- ask / capture 指向那一轮
  meta jsonb,                        -- 例：连按合并的次数 {"n":3}、在后台 {"bg":true}
  created_at timestamptz not null default now()
);

create index if not exists watch_events_source_idx
  on public.watch_events (user_id, source_id, at);

alter table public.watch_events enable row level security;

drop policy if exists "own watch events" on public.watch_events;
create policy "own watch events" on public.watch_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 为什么这张表带 `on delete cascade`、老表都不带 ──────────────────────────
-- 老表靠 `api/sources/[id]` 的 DELETE **手动按外键顺序删**（先切断 atoms、再删 interrupts……）。
-- 这张表要是也不带 cascade，**忘了在那条路由里补一步 = 从此所有看过的内容都删不掉**（外键报错）。
-- 而它是行为日志，没有任何要「删内容不连累」的资产（不像 atoms）。
-- `interrupt_id` 也 cascade：删一个问答点，那一行「?」跟着没（和 D62 之后「删点＝删那一轮」一个口径）。
-- `user_id` 照老表写法（不 cascade）—— 删账号今天是人工的，和别的表一起处理。
--
-- `kind` / `via` **不加 check 约束**：白名单放在 API 里（`lib/watch-events.ts`）。
-- 片 f 的回拨提示要加一种 `kind`，**别为它再开一次迁移**。

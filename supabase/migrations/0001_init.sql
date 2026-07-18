-- Fermata 初始迁移 — WORKORDER §3 数据模型 + RLS
-- 用法：在 Supabase Dashboard → SQL Editor 里整段粘贴运行一次。

create extension if not exists vector;

-- ─────────────────────────── sources ───────────────────────────
create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  kind text not null check (kind in ('youtube','podcast','manual')),
  external_id text,            -- videoId / episode guid
  url text,
  title text,
  content_lang text default 'en',
  duration_s int,
  transcript jsonb,            -- TranscriptSegment[]（见 §4）
  transcript_status text default 'pending'
    check (transcript_status in ('pending','partial','ready','failed')),
  created_at timestamptz default now()
);

-- ─────────────────────────── interrupts ───────────────────────────
create table interrupts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  source_id uuid references sources not null,
  t_s numeric not null,
  window_start_s numeric not null,   -- t−15
  window_end_s numeric not null,     -- t+3
  question text,
  question_mode text check (question_mode in ('word','concept','voice','free')),
  ai_answer text,
  created_at timestamptz default now()
);

-- ─────────────────────────── atoms ───────────────────────────
create table atoms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  source_id uuid references sources,
  interrupt_id uuid references interrupts,
  type text not null check (type in ('vocab','concept','claim')),
  term text not null,
  gloss text,
  context_quote text,
  content_lang text not null default 'en',
  support_lang text not null default 'zh',
  category text,                     -- AI 自动分类：法律 / AI / 语言 …
  embedding vector(768),
  -- FSRS 状态（ts-fsrs Card 字段一比一落库）
  due timestamptz default now(),
  stability real, difficulty real,
  reps int default 0, lapses int default 0,
  state text default 'new',
  last_review timestamptz,
  created_at timestamptz default now()
);

create index atoms_embedding_idx on atoms
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ─────────────────────────── sessions ───────────────────────────
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  mode text not null check (mode in ('post_session','weekly_interview')),
  source_id uuid references sources,
  category text,
  transcript jsonb,                  -- 访谈对话记录（input/output 转写）
  weak_atom_ids uuid[],
  started_at timestamptz default now(),
  ended_at timestamptz
);

-- ─────────────────────────── RLS：所有表只允许本人读写 ───────────────────────────
alter table sources    enable row level security;
alter table interrupts enable row level security;
alter table atoms      enable row level security;
alter table sessions   enable row level security;

create policy "own sources"    on sources    for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own interrupts" on interrupts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own atoms"      on atoms      for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sessions"   on sessions   for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

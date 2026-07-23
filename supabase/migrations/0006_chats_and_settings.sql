-- 0006: 沉浸聊天 + 用户设置（M3 Phase-2 长问答沉浸聊天）
-- 用法：Supabase → 项目 nlangqpdcjdmqkslfjks → SQL Editor → 整段粘贴 Run（跑第二遍也安全）。
-- 都是个人数据：RLS 只许本人读写，绝不跨用户（不同于 transcript_cache / translation_cache 的共享缓存）。

-- ─────────────── chats：每个(用户×视频)一条延续对话 ───────────────
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  source_id uuid references public.sources not null,
  -- 逐字原文：[{ role:'user'|'assistant', text, at_s 当时播到第几秒 }] —— 给用户看（再进入原样加载）
  messages jsonb not null default '[]'::jsonb,
  -- 退出时 compact 出的重点（用户问题 + 不懂/混淆点为主）—— 给 AI 当 context，不喂逐字
  summary text,
  -- messages 里前 summarized_upto 条已折进 summary；之后的是「本次会话的实时几轮」
  --   AI context = summary + messages.slice(summarized_upto) + 当前播放头字幕 + 全文
  summarized_upto int not null default 0,
  summary_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_id)
);

alter table public.chats enable row level security;

drop policy if exists "own chats" on public.chats;
create policy "own chats" on public.chats for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────── user_settings：流光颜色等（存后台=换设备同步）───────────────
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users,
  settings jsonb not null default '{}'::jsonb,   -- 流光配置放 settings.chatGlow
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

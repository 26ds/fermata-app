-- 0007: 观看历史（M3.6 历史与知识库）+ 顺手给 M3.7 词库预留的三列
-- 用法：Supabase → 项目 nlangqpdcjdmqkslfjks → SQL Editor → 整段粘贴 Run（跑第二遍也安全）。
--
-- 全是既有表上的加列，个人数据的 RLS 沿用原表策略，不用新建 policy。
-- M3.7 的三列现在就一次加完：加列是最便宜的迁移，让创始人为同一件事跑两次 SQL 才贵。

-- ─────────────── sources：这条内容"什么时候被看的、看过几次、长什么样" ───────────────
-- 在这之前库里只有 last_position_s（看到第几秒），**没有任何字段记得"什么时候看的"** ——
-- 这正是 M3.5 里内容库只能按"导入日期"分组、不能按"观看日期"分组的原因。
alter table public.sources add column if not exists last_watched_at timestamptz;
alter table public.sources add column if not exists watch_count int not null default 0;
-- 播客的封面图（导入时从 RSS / 苹果接口存下来）。
-- YouTube 不需要这一列：缩略图能由 external_id 直接拼出来，零存储零额度。
alter table public.sources add column if not exists thumb_url text;

-- ─────────────── M3.7 预留（本片不写不读，只是先把列备好）───────────────
-- 字幕转好后整片扫一次的地道词组结果；status: pending / running / ready / failed
alter table public.sources add column if not exists phrases jsonb;
alter table public.sources add column if not exists phrases_status text;
-- 词库点一个词跳回原视频那一秒 —— 存这个词出现在第几秒
alter table public.atoms add column if not exists t_s real;

-- 历史页固定是"按最近看过倒序取前几十条"，给它一条索引
create index if not exists sources_user_watched_idx
  on public.sources (user_id, last_watched_at desc nulls last);

-- 老数据不回填 last_watched_at。
-- 拿 created_at（导入时间）冒充观看时间就是撒谎 —— M3.5 已经为这件事专门写过一次说明。
-- 那些内容会落进历史页"时间不详"那一组，再看一遍就自动补上了。

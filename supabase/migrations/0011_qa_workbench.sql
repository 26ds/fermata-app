-- 0011 — M3.15 问答工作台（计划 §四）
--
-- **只加列、只加索引，一列都不改、一行都不删** —— 所以跑第二遍完全安全
-- （每一条都带 `if not exists`）。
--
-- 号在计划冻结那一刻就占死了：0009 预定给 M3.8 的 `folders`、0010 给 M2.7 的
-- `structure_cache`，那两片还没做，但**号不许被后来的人拿走**（plans/README.md 的规矩）。
--
-- D62：**每一轮问答就是一个捕获点** —— 新问答一律落 `interrupts`，
-- `chats` 退居二线只留 summary。所以这张表要多背四样东西：
-- 追问的父子关系、问题分类、答案引用了哪几个时刻、以及 Takeaway 的要点与勾选。

alter table public.interrupts
  -- 追问：上一轮答完之后**没有继续播视频**就又问的那一句，挂在母问题下面（计划 §B.4）
  add column if not exists parent_id  uuid references public.interrupts(id) on delete set null,
  -- D65 问题三分类：'language' | 'knowledge' | 'misheard'。**一个问题可以同时属于多类**，
  -- 所以是数组不是枚举。答题那一次调用顺带吐出来，不另开一次调用、不多花一分钱
  add column if not exists kinds      text[],
  -- D64：答案说「18:20 还会讲」时引用的那几个时刻 `[{t_s, quote, note}]`。
  -- **必须落库**，不能只留在内存里：卡片要能重新渲染，
  -- 而且将来查「AI 有没有编时间戳」要有据可查
  add column if not exists refs       jsonb,
  -- ③ Takeaway 的要点 `{points:[…], at:ISO}`。**懒生成**：切到那个 tab 才算（D44）
  add column if not exists takeaway   jsonb,
  -- 用户把这一条勾进「知识点」清单了吗
  add column if not exists saved      boolean not null default false;

-- 点点条、问题列表、`@` 单子都是「这条内容按时间排的所有点」，全走这一条
create index if not exists interrupts_source_t_idx
  on public.interrupts (user_id, source_id, t_s);

alter table public.sources
  -- D66 观看覆盖：看过的区间 `[[start,end],…]`（秒）。**要落库**，
  -- 否则关掉页面就白记了，点点条上的灰段下次进来就没了
  add column if not exists watched_ranges jsonb;

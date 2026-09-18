-- 0013 — M3.16 看画面回答（D75）
--
-- 用法：Supabase → 项目 nlangqpdcjdmqkslfjks → SQL Editor → 整段粘贴 Run。
-- **只加一列、一行都不改**，带 `if not exists`，跑第二遍完全安全。
-- RLS 不用动：`interrupts` 那条 "own interrupts" 策略是 for all，新列跟着整行走。
--
-- 号在 2026-09-18 冻结 M3.16 计划那一刻占死（plans/README.md 目录表上写着）。
-- 0009 预定给 M3.8 `folders`、0010 给 M2.7 `structure_cache` —— 那两片还没做，号不许被拿走。
--
-- 为什么要这一列（创始人 2026-09-18 拍的：两版答案都留、来回切、**都存库**）：
-- 点「看画面再答」拿到的那一版，花的钱更多、而且往往才是对的那版（他那次：画面上是导弹，
-- 只看字幕的那版说「敌机来了」）。只放内存的话一刷新就没了，库里留下的偏偏是看错的那版。
-- · `ai_answer` 仍是只看字幕的那版；这一列是看了画面的那版 —— **两列谁也不覆盖谁**；
-- · 不为空 ＝ 这一轮点过「看画面再答」（将来决定要不要「自动判」时，数据就在这儿）；
-- · 不另开一行 interrupts：D62 一轮问答＝一个捕获点，另开一行同一问会在捕获轴上长出两个点；
-- · 不塞进 `question_mode`：那一列有 check 约束，而且它说的是「怎么问的」，不是「答案看了什么」。

alter table public.interrupts
  add column if not exists ai_answer_visual text;

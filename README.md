# Fermata 𝄐

视频时代的主动学习层：把 YouTube 视频 / 播客拿进来播放，随时打断提问，看完进入学习模式，知识沉淀为可复习的知识原子，每周由 AI 语音访谈复盘。

- 唯一权威开发文档：[WORKORDER.md](./WORKORDER.md)
- 教学法内核：[.claude/skills/video-learning-tutor/SKILL.md](./.claude/skills/video-learning-tutor/SKILL.md)

## 本地跑起来（3 步）

```bash
npm install        # 第一次需要
cp .env.example .env.local   # 然后填入 Supabase 的 URL 和 anon key
npm run dev        # 打开 http://localhost:3000
```

没配 Supabase 时页面会显示配置引导，不会报错。

## Supabase 一次性设置

1. 在 [supabase.com](https://supabase.com) 创建项目（免费层即可）
2. Dashboard → SQL Editor → 粘贴运行 `supabase/migrations/0001_init.sql`
3. Dashboard → Project Settings → API：把 Project URL 和 anon public key 填进 `.env.local`
4. Dashboard → Authentication → URL Configuration：把 Site URL 设为你的域名（本地开发填 `http://localhost:3000`），Redirect URLs 加上 `http://localhost:3000/auth/callback` 和线上域名的 `/auth/callback`

## 技术栈

Next.js 16（App Router, TS）· Tailwind 4 · Supabase（Postgres + Auth + pgvector）· Dexie（离线缓存）· Serwist（PWA）· Vercel

## 里程碑状态

- [x] M0 工程骨架：登录（magic link）→ 空知识库；PWA 可添加到主屏幕
- [ ] M0.5 Gemini Live 通路 spike
- [ ] M1 播放器 + 打断捕获
- [ ] M2–M7 见 WORKORDER §5

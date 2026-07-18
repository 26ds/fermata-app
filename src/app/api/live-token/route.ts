import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

import { envLiveModel } from "@/lib/live/models";

// M0.5 — 给浏览器发 Live API 的临时通行证（ephemeral token）。
// D13 密钥纪律：真正的 GEMINI_API_KEY 只存在服务端环境变量，
// 客户端拿到的是 30 分钟过期、只能开一次会话的一次性 token。
// 请求体可带 { model } 指定模型（实验页下拉框），否则用 GEMINI_LIVE_MODEL / 默认值。

export async function POST(request: Request) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }

  // 只给登录用户发票，防止别人白嫖额度
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务器还没配置 GEMINI_API_KEY（Vercel → Settings → Environment Variables）" },
      { status: 500 },
    );
  }

  let requested = "";
  try {
    const body = await request.json();
    if (typeof body?.model === "string") requested = body.model.trim();
  } catch {
    // 没带 body 就用默认模型
  }
  const model =
    requested && /^[\w./-]+$/.test(requested) ? requested : envLiveModel();

  try {
    // ephemeral token 走 v1alpha（官方要求）
    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1, // 一张票只能开一次会话
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
        // 注意：这里绝不能加 liveConnectConstraints —— 一旦 token 带了约束，
        // 服务器会按 token 里锁定的配置建会话，浏览器端 config 里的字幕开关
        // （in/outputAudioTranscription）、系统人设、VAD 调参全被无视。
        // M0.5 第一版就是因为它字幕全无。M4 做正式功能时改为服务端锁"完整"配置。
      },
    });
    if (!token.name) {
      return NextResponse.json(
        { error: "Gemini 返回了空 token，请稍后重试" },
        { status: 502 },
      );
    }
    return NextResponse.json({ token: token.name, model });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const friendly = /API key not valid|API_KEY_INVALID/i.test(raw)
      ? "GEMINI_API_KEY 无效：去 aistudio.google.com 重新复制一遍，注意别带空格"
      : /quota|RESOURCE_EXHAUSTED|rate/i.test(raw)
        ? "Gemini 免费额度暂时用完了，等几分钟再试"
        : raw;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}

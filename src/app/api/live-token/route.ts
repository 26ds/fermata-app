import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// M0.5 — 给浏览器发 Live API 的临时通行证（ephemeral token）。
// D13 密钥纪律：真正的 GEMINI_API_KEY 只存在服务端环境变量，
// 客户端拿到的是 30 分钟过期、只能开一次会话的一次性 token。
// 模型名可用 GEMINI_LIVE_MODEL 覆盖（比如切到 gemini-3.1-flash-live-preview）。

const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export async function POST() {
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

  const model = process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL;

  try {
    // ephemeral token 走 v1alpha（官方要求）
    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1, // 一张票只能开一次会话（断线重连不算新会话）
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
        liveConnectConstraints: { model }, // 锁定模型，其余配置由客户端带上
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

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { envLiveModel } from "@/lib/live/models";

// M0.5 — 列出当前 GEMINI_API_KEY 能用的所有 Live（双向实时语音）模型，
// 供实验页下拉框选择。判定标准：supportedActions 含 bidiGenerateContent
// （Live WebSocket 的方法名）。翻译专用 / TTS 专用模型不含此能力，天然被过滤。

export async function GET() {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }
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
      { error: "服务器还没配置 GEMINI_API_KEY" },
      { status: 500 },
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const models: { name: string; displayName: string }[] = [];
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      if (!m.name || !m.supportedActions?.includes("bidiGenerateContent")) {
        continue;
      }
      const name = m.name.replace(/^models\//, "");
      models.push({ name, displayName: m.displayName || name });
    }
    // 名字倒序 ≈ 版本号大的排前面（gemini-3.x 排在 2.x 之前）
    models.sort((a, b) => b.name.localeCompare(a.name));
    return NextResponse.json({ models, default: envLiveModel() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

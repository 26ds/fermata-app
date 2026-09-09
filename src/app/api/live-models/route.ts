import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { envLiveModel } from "@/lib/live/models";
import { getT } from "@/lib/ui-lang";

// M0.5 — 列出当前 GEMINI_API_KEY 能用的 Live（双向实时语音）对话模型，
// 供实验页下拉框选择。两层过滤：
//   1) supportedActions 含 bidiGenerateContent（Live WebSocket 的方法名）
//   2) 白名单（创始人 2026-07-18 拍板）：3.x flash-live 全放行（3.1 保留、
//      未来 3.5 之类自动进入）；2.5 只留 native-audio-preview-12-2025 一个；
//      同传（live translate）、TTS 朗读等专用模型继续挡掉。

const ALLOW = [
  /^gemini-[3-9](?:\.\d+)?-flash-live(?:-|$)/,
  /^gemini-2\.5-flash-native-audio-preview-12-2025$/,
];
const DENY = [/translate|tts/];

export async function GET() {
  const t = await getT();
  if (!supabaseConfigured) {
    return NextResponse.json({ error: t("err.noSupabase") }, { status: 500 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: t("err.needLogin") }, { status: 401 });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: t("err.noGeminiKey") },
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
      if (!ALLOW.some((r) => r.test(name)) || DENY.some((r) => r.test(name))) {
        continue;
      }
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

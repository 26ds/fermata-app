import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// M3 Phase-2 —— 用户设置（存后台=换设备同步）。目前放沉浸聊天的流光颜色 settings.chatGlow。
// GET 取；PUT { settings } 浅合并进已有（改一个键不冲掉别的）。个人数据，RLS 只许本人（迁移 0006）。

type SettingsRow = { settings: Record<string, unknown> | null };

const putSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

export async function GET() {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ settings: (data as SettingsRow | null)?.settings ?? {} });
}

export async function PUT(request: Request) {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });

  // 浅合并进已有设置，别把没动的键冲没了
  const { data: existingRow } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", user.id)
    .maybeSingle();
  const existing = (existingRow as SettingsRow | null)?.settings ?? {};
  const merged = { ...existing, ...parsed.data.settings };

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: user.id, settings: merged, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ settings: merged });
}

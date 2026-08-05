import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { UI_LANG_COOKIE, UI_LANG_COOKIE_MAX_AGE, uiLocaleFromSettings } from "@/lib/ui-lang";

// M3 Phase-2 —— 用户设置（存后台=换设备同步）。目前放沉浸聊天的流光颜色 settings.chatGlow。
// GET 取；PUT { settings } 浅合并进已有（改一个键不冲掉别的）。个人数据，RLS 只许本人（迁移 0006）。
//
// M3.9 片 b 起，这条路由**顺带维护界面语言的 cookie 镜像**（`fermata_ui`）：
// 改语言的唯一入口就是这里的 PUT，所以镜像也只该在这里写。
// GET 顺带纠偏 —— 换了设备之后第一次取数，把这台机器上还没有的 cookie 补上。
// **真身永远是数据库**，cookie 只是让骨架屏和 `<html lang>` 零等待拿到语言（见 lib/ui-lang.ts）。

type SettingsRow = { settings: Record<string, unknown> | null };

/** 把界面语言写进 cookie 镜像。返回的还是同一个 response，方便直接 return */
function mirrorUiLang(res: NextResponse, settings: Record<string, unknown>): NextResponse {
  res.cookies.set(UI_LANG_COOKIE, uiLocaleFromSettings(settings), {
    path: "/",
    maxAge: UI_LANG_COOKIE_MAX_AGE,
    sameSite: "lax",
    // **故意不 httpOnly**：客户端也要读得到。
    // 里面只有一个语言码，不是凭据 —— 泄露了也没有任何价值。
  });
  return res;
}

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
  const settings = (data as SettingsRow | null)?.settings ?? {};
  return mirrorUiLang(NextResponse.json({ settings }), settings);
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

  // 只有写库成功了才动 cookie —— 镜像跑到真身前面去，就成了"界面已经换了、
  // 但换个设备登录又变回来"这种查不出来的怪事
  return mirrorUiLang(NextResponse.json({ settings: merged }), merged);
}

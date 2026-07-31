import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// M3.7 —— 从词库里去掉一条。勾错了、或者后来觉得没必要收，得能撤回。
// RLS 只许删自己的（迁移 0001 的 "own atoms"），这里再显式带一次 user_id 作双保险。

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });

  // Next 16：params 是 Promise，必须 await
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { error } = await supabase.from("atoms").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

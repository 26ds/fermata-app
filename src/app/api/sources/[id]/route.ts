import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// M1a — 回写真实时长。oEmbed 给不了时长，只有播放器就绪后 getDuration() 才知道。
// 点点条（1c）要靠 duration 把打断点摆到正确的百分比位置。

const bodySchema = z.object({
  durationS: z.number().positive().max(24 * 3600),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }

  // Next 16：params 是 Promise，必须 await（同步访问已被彻底移除）
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let durationS: number;
  try {
    const result = bodySchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json({ error: "时长不合法" }, { status: 400 });
    }
    durationS = Math.round(result.data.durationS);
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }

  // RLS 已经把范围锁死在本人行上，这里再显式带 user_id 是双保险
  const { error } = await supabase
    .from("sources")
    .update({ duration_s: durationS })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

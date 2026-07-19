import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// M1a — 单条内容源的更新与删除。
// PATCH：回写真实时长（oEmbed 给不了，只有播放器就绪后才知道）与"看到第几秒"。
// DELETE：从列表里移除。

const patchSchema = z
  .object({
    durationS: z.number().positive().max(24 * 3600).optional(),
    lastPositionS: z.number().min(0).max(24 * 3600).optional(),
    pinned: z.boolean().optional(),
    favorited: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "没有要更新的字段",
  });

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }

  // Next 16：params 是 Promise，必须 await（同步访问已被彻底移除）
  const { id } = await params;

  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let patch: {
    duration_s?: number;
    last_position_s?: number;
    pinned_at?: string | null;
    favorited_at?: string | null;
  };
  try {
    const result = patchSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
    }
    patch = {};
    if (result.data.durationS !== undefined) {
      patch.duration_s = Math.round(result.data.durationS);
    }
    if (result.data.lastPositionS !== undefined) {
      patch.last_position_s = Math.round(result.data.lastPositionS);
    }
    // 时间戳而不是布尔：取消就写 null，置上就写"此刻"（见 D16）
    if (result.data.pinned !== undefined) {
      patch.pinned_at = result.data.pinned ? new Date().toISOString() : null;
    }
    if (result.data.favorited !== undefined) {
      patch.favorited_at = result.data.favorited ? new Date().toISOString() : null;
    }
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }

  // RLS 已经把范围锁死在本人行上，这里再显式带 user_id 是双保险
  const { error } = await supabase
    .from("sources")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }

  const { id } = await params;

  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // 外键顺序不能乱，而且有一条原则：删内容不能连累知识。
  // ① 知识原子是用户攒下来的资产，只切断它与来源的关联，绝不删除
  const { error: atomError } = await supabase
    .from("atoms")
    .update({ source_id: null, interrupt_id: null })
    .eq("source_id", id)
    .eq("user_id", user.id);
  if (atomError) {
    return NextResponse.json({ error: atomError.message }, { status: 500 });
  }

  // ② 打断点离开这条内容就没有意义了，跟着删
  const { error: interruptError } = await supabase
    .from("interrupts")
    .delete()
    .eq("source_id", id)
    .eq("user_id", user.id);
  if (interruptError) {
    return NextResponse.json({ error: interruptError.message }, { status: 500 });
  }

  const { error } = await supabase
    .from("sources")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

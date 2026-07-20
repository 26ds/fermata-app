import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// M1a — 单条内容源的更新与删除。
// PATCH：回写真实时长（oEmbed 给不了，只有播放器就绪后才知道）与"看到第几秒"。
// DELETE：从列表里移除。

// M1d：手动贴进来的字幕。段的形状就是 TranscriptSegment —— M2 的自动转写
// 产出同一个形状写同一个字段，到时候不用改这里，也不用改渲染层。
const segmentSchema = z.object({
  start: z.number().min(0).max(24 * 3600),
  end: z.number().min(0).max(24 * 3600),
  text: z.string().min(1).max(2000),
  speaker: z.string().max(120).optional(),
});

const patchSchema = z
  .object({
    durationS: z.number().positive().max(24 * 3600).optional(),
    lastPositionS: z.number().min(0).max(24 * 3600).optional(),
    pinned: z.boolean().optional(),
    favorited: z.boolean().optional(),
    transcript: z.array(segmentSchema).min(1).max(5000).optional(),
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
    transcript?: z.infer<typeof segmentSchema>[];
    transcript_status?: string;
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
    if (result.data.transcript !== undefined) {
      patch.transcript = result.data.transcript;
      // 有字幕了就是 ready —— 悬浮球的双态色、字幕层的开关都读这一个字段，
      // 手贴的和 M2 自动转写的在下游没有区别
      patch.transcript_status = "ready";
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

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getLangPrefs } from "@/lib/settings";
import { conformSegments } from "@/lib/zh-convert";
import { captionScriptFor } from "@/lib/zh-script";
import { getT } from "@/lib/ui-lang";

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
    // M3.6 观看历史（迁移 0007）：真播起来了就记一笔"这条什么时候被看的"。
    // countsAsNewWatch 由客户端算 —— "今天"是**看的人所在时区**的今天，服务端在 UTC 上算不准。
    watched: z.boolean().optional(),
    countsAsNewWatch: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "err.nothingToUpdate",
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
  const t = await getT();
  if (!supabaseConfigured) {
    return NextResponse.json({ error: t("err.noSupabase") }, { status: 500 });
  }

  // Next 16：params 是 Promise，必须 await（同步访问已被彻底移除）
  const { id } = await params;

  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: t("err.needLogin") }, { status: 401 });
  }

  let patch: {
    duration_s?: number;
    last_position_s?: number;
    pinned_at?: string | null;
    favorited_at?: string | null;
    transcript?: z.infer<typeof segmentSchema>[];
    transcript_status?: string;
  };
  let watched = false;
  let countsAsNewWatch = false;
  try {
    const result = patchSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json({ error: t("err.badRequest") }, { status: 400 });
    }
    patch = {};
    watched = result.data.watched === true;
    countsAsNewWatch = result.data.countsAsNewWatch === true;
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
    return NextResponse.json({ error: t("err.badFormat") }, { status: 400 });
  }

  // RLS 已经把范围锁死在本人行上，这里再显式带 user_id 是双保险
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("sources")
      .update(patch)
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // M3.6 观看历史 —— **单独一条 update**，不和上面那条合并。
  // 迁移 0007 没跑时 last_watched_at / watch_count 这两列并不存在，
  // 混在一起写会让"回写看到第几秒"跟着一起失败，那才是真损失。
  let watchHistory = true;
  if (watched) {
    const update: { last_watched_at: string; watch_count?: number } = {
      last_watched_at: new Date().toISOString(),
    };
    if (countsAsNewWatch) {
      // 没有原子自增就先读再写。个人数据、同一时刻不会有第二个写者，够用了
      const { data: row } = await supabase
        .from("sources")
        .select("watch_count")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      update.watch_count = ((row as { watch_count?: number | null } | null)?.watch_count ?? 0) + 1;
    }
    const { error: watchError } = await supabase
      .from("sources")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id);
    // 写不上不该拦住看视频 —— 如实回报一声，让调用方知道这次没记上
    if (watchError) watchHistory = false;
  }

  // 用户手动粘贴的字幕**只归他自己**，不回填跨用户缓存（2026-09-26，D31 补记 · 创始人选 B）。
  // 以前是「粘一次，别人打开同一支直接白拿」—— 可那也意味着谁都能贴一份假字幕，
  // 塞给之后打开同一支视频的所有人。共享缓存从此只收机器转写（`/api/transcript`）；
  // 由粘贴字幕翻出来的译文同样不进共享缓存（`/api/translate` + `lib/transcript/shared.ts`）。

  // D50：他贴进来的可能是繁体、而他母语是简体（反之亦然）。库里存**原样**（那是底本），
  // **回给浏览器的这一份转成他的字形** —— 转换在服务端，
  // 客户端不背那 1MB 词库。
  const screenTranscript = patch.transcript
    ? conformSegments(patch.transcript, captionScriptFor(await getLangPrefs(supabase, user.id)))
    : undefined;

  return NextResponse.json({ ok: true, watchHistory, transcript: screenTranscript });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const t = await getT();
  if (!supabaseConfigured) {
    return NextResponse.json({ error: t("err.noSupabase") }, { status: 500 });
  }

  const { id } = await params;

  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: t("err.needLogin") }, { status: 401 });
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

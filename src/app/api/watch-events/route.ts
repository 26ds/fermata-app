import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/ui-lang";
import { tMaybeKey } from "@/lib/copy";
import { isMissingTableError, watchBatchSchema } from "@/lib/watch-events";

// M3.15 片 c0 —— 互动记录落库（D71，迁移 0012 `watch_events`）。
//
// 浏览器攒着、成批送来：每问一句 / 记一个点时（保证「先跳后问」的顺序落得住）、每 30 秒、
// 离开页面时（keepalive）。**只收不改**：同一个 id 再来一次直接忽略 —— 网络抖了、keepalive 重发，
// 库里都不会多出一行。
//
// 它不花钱，所以浏览器那头存不上会自己再补（D44 只禁止代码替人重试**花钱**的动作）；
// 但存不上的原因要说得出（D44 前半句）：401 / 表不存在 / 其他，各回各的，浏览器照实写在互动记录顶上。

/** 秒数可以比库里的时长多出这么一点：播放器报的时长和存下来的差一两秒是常事 */
const DURATION_SLACK_S = 5;

export async function POST(request: Request) {
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

  let body: z.infer<typeof watchBatchSchema>;
  try {
    const result = watchBatchSchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(
        { error: tMaybeKey(t, result.error.issues[0]?.message, "err.badFormat") },
        { status: 400 },
      );
    }
    body = result.data;
  } catch {
    return NextResponse.json({ error: t("err.badFormat") }, { status: 400 });
  }

  // RLS 保证 watch_events.user_id 是自己，但拦不住"把记录挂到别人的内容上"——
  // 先确认这条内容是本人的（RLS 会让别人的 source 查不到）
  const { data: src } = await supabase
    .from("sources")
    .select("id, duration_s")
    .eq("id", body.sourceId)
    .maybeSingle();
  if (!src) {
    return NextResponse.json({ error: t("err.sourceMissing") }, { status: 404 });
  }
  const duration = Number((src as { duration_s: number | null }).duration_s);
  const maxS = duration > 0 ? duration + DURATION_SLACK_S : 24 * 3600;

  // interrupt_id 只许指向**本人还在的**那一轮（RLS 让别人的查不到）。
  // 刚删掉的点指过来会让整批撞外键、从此卡死 —— 在那之前就把那几行筛掉，它们本来也会跟着 cascade 走。
  const ids = [...new Set(body.events.flatMap((e) => (e.interruptId ? [e.interruptId] : [])))];
  let alive = new Set<string>();
  if (ids.length > 0) {
    const { data: rows, error } = await supabase.from("interrupts").select("id").in("id", ids);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    alive = new Set((rows ?? []).map((r) => (r as { id: string }).id));
  }

  // 秒数超出时长的那几行单独丢掉，别让一行坏的把同一批里好的一起拖下水
  const rows = body.events
    .filter((e) => (e.fromS ?? 0) <= maxS && (e.toS ?? 0) <= maxS)
    .filter((e) => !e.interruptId || alive.has(e.interruptId))
    .map((e) => ({
      id: e.id,
      // user_id 是 not null 且无默认值 —— 必须显式写，否则过不了 RLS 的 with check
      user_id: user.id,
      source_id: body.sourceId,
      visit_id: e.visitId,
      seq: e.seq,
      at: e.at,
      kind: e.kind,
      from_s: e.fromS,
      to_s: e.toS,
      dur_ms: e.durMs,
      rate: e.rate,
      via: e.via,
      interrupt_id: e.interruptId,
      meta: e.meta,
    }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("watch_events")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      // 迁移 0012 还没跑：说清楚是这个原因，浏览器那头就不再白送了
      if (isMissingTableError(error)) {
        return NextResponse.json(
          { error: t("err.watchEventsMissing"), code: "missing_table" },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, saved: rows.length, skipped: body.events.length - rows.length });
}

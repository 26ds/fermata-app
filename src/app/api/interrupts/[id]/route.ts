import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/ui-lang";
import { tMaybeKey } from "@/lib/copy";

// M1c — 给已记下的打断点补一个"卡在哪"的类型。
// 点球 = 先把这一刻记下来（POST），面板里选 chip = 回头补类型（这里）。
// 1c 只写 question_mode，不请求 AI；M3 再往同一行写 question / ai_answer。

const patchSchema = z.object({
  questionMode: z.enum(["word", "concept", "voice", "free"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // Next 16：params 是 Promise，必须 await
  const { id } = await params;

  let body: z.infer<typeof patchSchema>;
  try {
    const result = patchSchema.safeParse(await request.json());
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

  const { data, error } = await supabase
    .from("interrupts")
    .update({ question_mode: body.questionMode })
    .eq("id", id)
    .eq("user_id", user.id) // RLS 之外再加一道，别人的行改不动
    .select("id, t_s, question_mode")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: t("err.noInterrupt") }, { status: 404 });
  }

  return NextResponse.json(data);
}

/**
 * 1c-fix / D19 —— 删掉一个误点的捕获点。
 * atoms.interrupt_id 是外键，直接删会被数据库拦下；照 1a 删 source 的规矩：
 * **先把知识原子解绑，再删点** —— 点是误记的，从它长出来的知识不是。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // Next 16：params 是 Promise，必须 await
  const { id } = await params;

  const { error: detachError } = await supabase
    .from("atoms")
    .update({ interrupt_id: null })
    .eq("interrupt_id", id)
    .eq("user_id", user.id);
  if (detachError) {
    return NextResponse.json({ error: detachError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("interrupts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id) // RLS 之外再加一道
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: t("err.noInterrupt") }, { status: 404 });
  }

  return NextResponse.json({ id: data.id });
}

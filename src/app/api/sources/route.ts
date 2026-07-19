import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { detectAdapter } from "@/lib/sources/registry";

// M1a — 导入一条内容源。只存指针（kind + external_id + url），永不下载媒体（D3/§10）。

const bodySchema = z.object({
  url: z.string().trim().min(1, "请贴一条链接"),
});

export async function POST(request: Request) {
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let parsedBody: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message ?? "请求格式不对" },
        { status: 400 },
      );
    }
    parsedBody = result.data;
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }

  const detected = detectAdapter(parsedBody.url);
  if (!detected) {
    return NextResponse.json(
      { error: "这条链接暂时认不出来。M1 先支持 YouTube 视频链接。" },
      { status: 400 },
    );
  }
  const { adapter, parsed } = detected;

  // 同一个人重复贴同一条链接 → 直接回旧的，不建重复行
  const { data: existing } = await supabase
    .from("sources")
    .select("id")
    .eq("user_id", user.id)
    .eq("kind", adapter.kind)
    .eq("external_id", parsed.externalId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ id: existing.id, reused: true });
  }

  const meta = await adapter.resolve(parsed);

  // user_id 是 not null 且没有默认值 —— 每次 insert 必须显式写，
  // 否则连 RLS 的 with check 都进不去。
  const { data, error } = await supabase
    .from("sources")
    .insert({
      user_id: user.id,
      kind: adapter.kind,
      external_id: parsed.externalId,
      url: parsed.url,
      title: meta.title,
      duration_s: meta.durationS,
      transcript_status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "保存失败，请重试" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, reused: false });
}

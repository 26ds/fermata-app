import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { detectAdapter } from "@/lib/sources/registry";
import { SourceResolveError } from "@/lib/sources/types";

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
      { error: "这条链接暂时认不出来。现在支持 YouTube 视频、播客 RSS，以及音频直链。" },
      { status: 400 },
    );
  }
  const { adapter, parsed } = detected;

  const findExisting = async (externalId: string) =>
    (
      await supabase
        .from("sources")
        .select("id")
        .eq("user_id", user.id)
        .eq("kind", adapter.kind)
        .eq("external_id", externalId)
        .maybeSingle()
    ).data;

  // 快路：链接本身就是身份（YouTube 的 videoId、音频直链）→ 一次查询就回旧的，
  // 连网络元数据都不用取。
  const known = await findExisting(parsed.externalId);
  if (known) {
    return NextResponse.json({ id: known.id, reused: true });
  }

  // M1d：resolve 可以给出更精确的指针（播客：订阅源 → 具体某一集），见 ResolvedMeta。
  let meta: Awaited<ReturnType<typeof adapter.resolve>>;
  try {
    meta = await adapter.resolve(parsed);
  } catch (e) {
    // 说得清原因的（不是 feed、里面没音频…）直接把话讲给用户；其余当上游抽风
    if (e instanceof SourceResolveError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "对方服务器没响应，过一会儿再试" }, { status: 502 });
  }

  const externalId = meta.externalId ?? parsed.externalId;
  const url = meta.url ?? parsed.url;

  // 慢路：身份是 resolve 之后才知道的（同一个播客订阅源第二次贴进来，
  // 最新一集没变 → 还是同一集，不该建第二行）。
  if (externalId !== parsed.externalId) {
    const sameEpisode = await findExisting(externalId);
    if (sameEpisode) {
      return NextResponse.json({ id: sameEpisode.id, reused: true });
    }
  }

  // user_id 是 not null 且没有默认值 —— 每次 insert 必须显式写，
  // 否则连 RLS 的 with check 都进不去。
  const { data, error } = await supabase
    .from("sources")
    .insert({
      user_id: user.id,
      kind: adapter.kind,
      external_id: externalId,
      url,
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

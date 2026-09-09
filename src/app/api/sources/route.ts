import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { detectAdapter } from "@/lib/sources/registry";
import { SourceResolveError } from "@/lib/sources/types";
import { getT } from "@/lib/ui-lang";
import { tMaybeKey } from "@/lib/copy";

// M1a — 导入一条内容源。只存指针（kind + external_id + url），永不下载媒体（D3/§10）。

const bodySchema = z.object({
  url: z.string().trim().min(1, "err.needUrl"),
});

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

  let parsedBody: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(await request.json());
    if (!result.success) {
      return NextResponse.json(
        { error: tMaybeKey(t, result.error.issues[0]?.message, "err.badFormat") },
        { status: 400 },
      );
    }
    parsedBody = result.data;
  } catch {
    return NextResponse.json({ error: t("err.badFormat") }, { status: 400 });
  }

  const detected = detectAdapter(parsedBody.url);
  if (!detected) {
    return NextResponse.json(
      { error: t("err.unknownLink") },
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
    return NextResponse.json({ error: t("err.upstreamTimeout") }, { status: 502 });
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
      // D42：这一列的数据库默认值是 `'en'` —— 一条早期的偏见。刚导入时我们**根本
      // 还不知道**这条内容是什么语言（字幕都没转），写 `'en'` 是在编。写 null =
      // 如实的"还不知道"，等 /api/transcript 拿到模型实测的语言再回填。
      // 迁移不改默认（D42 定的），靠这里显式写值把默认值架空。
      content_lang: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? t("err.saveFailed") },
      { status: 500 },
    );
  }

  // M3.6 封面：**单独一条 update**，故意不并进上面的 insert。
  // thumb_url 是迁移 0007 才有的列，迁移没跑时并进去会让**整次导入失败** ——
  // 为了一张缩略图把"贴链接"这件事搞坏，那是本末倒置。写不上就没图，历史页画占位块。
  if (meta.thumbUrl) {
    await supabase
      .from("sources")
      .update({ thumb_url: meta.thumbUrl })
      .eq("id", data.id)
      .eq("user_id", user.id);
  }

  return NextResponse.json({ id: data.id, reused: false });
}

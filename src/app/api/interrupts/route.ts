import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/ui-lang";
import { tMaybeKey } from "@/lib/copy";

// M1c — 记一个打断点：指针 (source, t) + 上下文窗口 [t−15, t+3]。
// 1c 只负责"记下来"，不请求 AI —— 问答是 M3，那时直接拿 window_* 去截转写，不用改表。

/** D5：打断点的上下文窗口 —— 往前 15 秒、往后 3 秒 */
const WINDOW_BEFORE_S = 15;
const WINDOW_AFTER_S = 3;

const bodySchema = z.object({
  sourceId: z.string().min(1, "err.needSourceId"),
  tS: z.number().min(0).max(24 * 3600),
  questionMode: z.enum(["word", "concept", "voice", "free"]).nullish(),
  /**
   * M3.15 片 b（计划 §B.4）：这一轮是**追问**的话，挂在母问题下面。
   * 判据在客户端定（"上一轮答完之后有没有继续播过视频"），服务端只负责存 ——
   * 那件事只有播放器知道，服务端问不到。
   *
   * ⚠️ 迁移 0011 的列。**0011 没跑的话这一句会让整条 insert 失败**，
   * 而失败会原样冒到界面上（下面那个 500 分支）—— 这是**故意**的：
   * 悄悄丢掉 parent_id 会让追问看着像普通问题，谁都发现不了（D44）。
   */
  parentId: z.string().uuid().nullish(),
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

  let body: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(await request.json());
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

  // RLS 保证 interrupts.user_id 是自己，但拦不住"把点记到别人的 source 上"。
  // 先确认这条 source 确实属于本人（RLS 会让别人的 source 查不到）。
  const { data: owned } = await supabase
    .from("sources")
    .select("id")
    .eq("id", body.sourceId)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: t("err.sourceMissing") }, { status: 404 });
  }

  // 变量叫 `tS` 不叫 `t` —— `t` 是翻译函数（M3.9 片 c）
  const tS = body.tS;
  const { data, error } = await supabase
    .from("interrupts")
    .insert({
      // user_id 是 not null 且无默认值 —— 必须显式写，否则过不了 RLS 的 with check
      user_id: user.id,
      source_id: body.sourceId,
      t_s: tS,
      // 窗口现在就按 D5 定死，M3 直接拿来用
      window_start_s: Math.max(0, tS - WINDOW_BEFORE_S), // 夹到 0：负数窗口没有意义
      window_end_s: tS + WINDOW_AFTER_S,
      question_mode: body.questionMode ?? null,
      parent_id: body.parentId ?? null,
    })
    // question / ai_answer 新点必然是空的，仍然带回来 —— 前端的暂停点回看列表（M3.5）
    // 要的就是这个形状，少两列就得在客户端补 null，白白多一处"两边形状不一样"的坑。
    // M3.15 片 b 又多带两列：`created_at`（问答流按落库时间排，不是按 t_s）
    // 和 `parent_id`（追问缩进）—— 少了它们，刚问完那一轮在流里的位置和刷新之后不一样。
    .select("id, t_s, question_mode, question, ai_answer, created_at, parent_id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? t("err.interruptSaveFailed") },
      { status: 500 },
    );
  }

  return NextResponse.json(data);
}

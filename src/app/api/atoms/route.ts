import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeLang, studyMode } from "@/lib/lang";
import { getLangPrefs } from "@/lib/settings";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow } from "@/lib/types";
import { getT } from "@/lib/ui-lang";

// M3.7 词库 —— 打勾收藏一个词组（D40）。
//
// **零新表**：落 `atoms`（迁移 0001 就建好了），字段本来就是为这个准备的 ——
// `term` 词组 / `gloss` 一句话解释 / `context_quote` 它出现的那句原话 / `source_id`，
// **而且自带 FSRS 全套字段 → 词库天生就是 M5 的复习卡片**，不用另起炉灶。
// 只缺"第几秒"，那是迁移 0007 加的 `t_s`（已跑）。
//
// 不给每个勾选的词造一条 interrupt —— 那会把暂停点列表污染成"我勾过的词"。

const schema = z.object({
  sourceId: z.string().uuid(),
  term: z.string().trim().min(1).max(200),
  gloss: z.string().trim().max(500).optional(),
  contextQuote: z.string().trim().max(2000).optional(),
  tS: z.number().finite().min(0).optional(),
});

export async function POST(request: Request) {
  const t = await getT();
  if (!supabaseConfigured) return NextResponse.json({ error: t("err.noSupabase") }, { status: 500 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("err.badRequest") }, { status: 400 });
  const { sourceId, term, gloss, contextQuote, tS } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: t("err.needLogin") }, { status: 401 });

  const { data: srcRow } = await supabase
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!srcRow) return NextResponse.json({ error: t("err.noSource") }, { status: 404 });
  const source = srcRow as SourceRow;

  // 同一条内容里同一个词组只收一次 —— 面板勾一次、往回翻字幕又勾一次是很自然的动作，
  // 不该在词库里变成两条一模一样的
  const { data: dupe } = await supabase
    .from("atoms")
    .select("*")
    .eq("user_id", user.id)
    .eq("source_id", sourceId)
    .eq("term", term)
    .maybeSingle();
  if (dupe) return NextResponse.json({ atom: dupe, existed: true });

  const prefs = await getLangPrefs(supabase, user.id);
  const contentLang = normalizeLang(source.content_lang);
  const mode = studyMode(contentLang, prefs.nativeLang, prefs.targetLang);

  // D42 红线：`content_lang` / `support_lang` **显式写值**。
  // 数据库默认是 `'en'` / `'zh'` —— 早期"中文人学英文"的偏见，绝不许依赖。
  // 真不知道就写空串，也不许拿 'en' 冒充。
  const row = {
    user_id: user.id,
    source_id: sourceId,
    type: mode === "language" ? "vocab" : "concept",
    term,
    gloss: gloss || null,
    context_quote: contextQuote || null,
    content_lang: contentLang,
    support_lang: prefs.nativeLang,
  };

  // t_s 是迁移 0007 的列（已跑）。万一某个库没跑到，退一步不带它插 ——
  // 少一个"跳回第几秒"，总好过整个收藏功能报错
  let { data: atom, error } = await supabase.from("atoms").insert({ ...row, t_s: tS ?? null }).select("*").single();
  if (error) {
    ({ data: atom, error } = await supabase.from("atoms").insert(row).select("*").single());
  }
  if (error || !atom) {
    return NextResponse.json({ error: error?.message ?? t("err.atomSaveFailed") }, { status: 500 });
  }

  return NextResponse.json({ atom });
}

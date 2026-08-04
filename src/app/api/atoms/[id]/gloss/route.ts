import { NextResponse } from "next/server";
import { normalizeLang, studyMode } from "@/lib/lang";
import { PhraseError, glossTerm } from "@/lib/phrases/gemini-phrases";
import { getLangPrefs } from "@/lib/settings";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow } from "@/lib/types";

// M3.10 手动选词 —— 给用户**自己划下来**的那一段补一句解释（D45 片 d）。
//
// 为什么是"先存词、再补解释"这个顺序（M3.10-plan §C，不许反）：
// 存下来才是主诉求。**AI 挂了不该让人连词都存不上** —— 所以 `POST /api/atoms`
// 那一步允许 `gloss` 为空，界面上 ✓ 立刻变实心，解释晚一两秒再跟上。
//
// D44：这支只由**人的动作**触发（划完词一次、或词库里点「再试一次」）。
// **代码永远不许自己重试**，它花钱。取不到就如实留白，让人自己决定要不要再点。

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });

  // Next 16：params 是 Promise，必须 await
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { data: atom } = await supabase
    .from("atoms")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!atom) return NextResponse.json({ error: "找不到这条词" }, { status: 404 });

  // 已经有解释了就原样奉还。**同一条词绝不付第二次钱** ——
  // 「再试一次」是个按钮，手抖点两下是很正常的事
  const existing = typeof atom.gloss === "string" ? atom.gloss.trim() : "";
  if (existing) return NextResponse.json({ atom, existed: true });

  // 内容语言以这条词自己存的为准（收藏当时写死的，D42 红线），
  // 空了才回头问这条内容 —— 那时候 `content_lang` 可能刚被 detect 补上
  let contentLang = normalizeLang(atom.content_lang);
  if (!contentLang && atom.source_id) {
    const { data: srcRow } = await supabase
      .from("sources")
      .select("*")
      .eq("id", atom.source_id)
      .eq("user_id", user.id)
      .maybeSingle();
    contentLang = normalizeLang((srcRow as SourceRow | null)?.content_lang);
  }

  const prefs = await getLangPrefs(supabase, user.id);
  const mode = studyMode(contentLang, prefs.nativeLang, prefs.targetLang);

  let gloss: string;
  try {
    gloss = await glossTerm({
      term: String(atom.term ?? ""),
      context: String(atom.context_quote ?? ""),
      mode,
      contentLang,
      nativeLang: prefs.nativeLang,
      targetLang: prefs.targetLang ?? "",
    });
  } catch (e) {
    // D44：**四种结局要分得开**。只说"失败了"的话，没配 key、被限流、超时、
    // 和"模型给了个空答案"从外面看一模一样，谁都查不出来
    const message =
      e instanceof PhraseError
        ? e.message
        : e instanceof Error && e.name === "TimeoutError"
          ? "取解释超时了（20 秒没回来）。"
          : "取解释时出错了。";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: updated, error } = await supabase
    .from("atoms")
    .update({ gloss })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  // 解释已经生成出来了，只是没存进去 —— **照样把它交出去**，
  // 起码这一次用户能看到；下次再点会重新生成（重新花钱，但那是他自己点的）
  if (error || !updated) {
    return NextResponse.json({ atom: { ...atom, gloss }, saved: false });
  }

  return NextResponse.json({ atom: updated });
}

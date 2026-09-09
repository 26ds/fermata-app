import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeLang, sameLang, studyMode } from "@/lib/lang";
import { PhraseError } from "@/lib/phrases/gemini-phrases";
import { lookupTerm } from "@/lib/senses/gemini-senses";
import { readSenses, senseKey, type Lookup, type Sense } from "@/lib/senses/types";
import { getLangPrefs } from "@/lib/settings";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow } from "@/lib/types";
import { getT } from "@/lib/ui-lang";

// M3.11 悬浮词卡 —— 气泡里那两半东西从哪来（plans/M3.11-plan.md §B）。
//
// **这支路由存在的全部意义是"尽量不花钱"**：
//
//   语境意思  已经在 `atoms.gloss` 里（M3.10 收词时付过了）→ 直接读出来，**秒出、零成本**。
//             只有一种情况要重算：他**改了母语**，那条解释还是旧语言写的（`atoms.support_lang` 对不上）。
//             那就当场重生成并写回 —— **懒加载，看到哪条换哪条**，绝不批量重刷几百条
//             （那是一笔他没同意过的钱，而且大部分他根本不会再看）。
//
//   常用义项  「because 有哪三个常用义项」**和是谁收的、在哪个视频收的毫无关系** ——
//             全世界只该算一次。所以走 `word_senses` 这张跨用户共享表（迁移 0008，
//             和 0004 字幕缓存 / 0005 译文缓存同一套 RLS 纪律，表里没有任何个人数据）。
//             某个词在某门母语里第一个查的人付一次，之后所有人**永远瞬间、免费**。
//
// D44：查不到要说出是哪一种结局（`sensesStatus`），并给**人点的**重试；代码永不自动重来。

const schema = z.object({
  term: z.string().trim().min(1).max(200),
  /** 它出现的那句原话 —— 判断"在这一句里是什么意思"全靠它 */
  contextQuote: z.string().trim().max(2000).optional(),
  sourceId: z.string().uuid().optional(),
  /** 这个词对应的那条 atom（阴影词一定有）。没有就只查通用义项 */
  atomId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const t = await getT();
  if (!supabaseConfigured) return NextResponse.json({ error: t("err.noSupabase") }, { status: 500 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("err.badRequest") }, { status: 400 });
  const { term, contextQuote, sourceId, atomId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: t("err.needLogin") }, { status: 401 });

  const prefs = await getLangPrefs(supabase, user.id);
  const supportLang = prefs.nativeLang;

  // ── 这个词是什么语言 ──────────────────────────────────────────
  // 以那条 atom 收藏当时写死的为准（D42 红线：显式写值），空了才回头问这条内容
  let atom: Record<string, unknown> | null = null;
  if (atomId) {
    const { data } = await supabase
      .from("atoms")
      .select("*")
      .eq("id", atomId)
      .eq("user_id", user.id)
      .maybeSingle();
    atom = data ?? null;
  }

  let contentLang = normalizeLang(atom?.content_lang as string | null | undefined);
  if (!contentLang && sourceId) {
    const { data: srcRow } = await supabase
      .from("sources")
      .select("*")
      .eq("id", sourceId)
      .eq("user_id", user.id)
      .maybeSingle();
    contentLang = normalizeLang((srcRow as SourceRow | null)?.content_lang);
  }
  const mode = studyMode(contentLang, prefs.nativeLang, prefs.targetLang);

  // ── ① 语境意思：库里有、且是**当前母语**写的，就白拿 ────────────
  const storedGloss = typeof atom?.gloss === "string" ? (atom.gloss as string).trim() : "";
  const storedPos = typeof atom?.gloss_pos === "string" ? (atom.gloss_pos as string).trim() : "";
  // `support_lang` 空的一律当"对不上" —— 早期数据没记语言，不能假装它就是现在这门
  const glossFresh =
    storedGloss !== "" && !!supportLang && sameLang(atom?.support_lang as string, supportLang);
  let context: Sense | null = glossFresh ? { pos: storedPos, gloss: storedGloss } : null;

  // ── ② 常用义项：全站共享缓存 ────────────────────────────────
  const key = senseKey(term);
  let senses: Sense[] = [];
  let cacheHit = false;
  if (supportLang && contentLang) {
    const { data: cached } = await supabase
      .from("word_senses")
      .select("senses")
      .eq("term", key)
      .eq("content_lang", contentLang)
      .eq("support_lang", supportLang)
      .maybeSingle();
    if (cached) {
      cacheHit = true; // **命中即认**，哪怕存的是空数组 —— 那代表"查过了，它确实没有别的义项"
      senses = readSenses(cached.senses);
    }
  }

  // ── 两半都齐了 → 一个模型调用都不发 ──────────────────────────
  let sensesStatus: Lookup["sensesStatus"] = cacheHit ? (senses.length > 0 ? "ok" : "none") : "ok";
  if (context && cacheHit) {
    return NextResponse.json({ term, context, senses, supportLang, sensesStatus, cached: true });
  }

  // ── 缺哪半补哪半。两半都缺时**一次调用同时产出**，比分两趟便宜 ──
  try {
    const result = await lookupTerm({
      term,
      context: contextQuote || (typeof atom?.context_quote === "string" ? atom.context_quote : ""),
      mode,
      contentLang,
      nativeLang: prefs.nativeLang,
      targetLang: prefs.targetLang ?? "",
      wantContext: !context,
      wantSenses: !cacheHit,
    });

    if (!context && result.context) {
      context = result.context;
      // 写回那条 atom —— **下一次悬浮就不用再花这笔钱了**，
      // 这也正是"改了母语，以前的解释都变成新语言"落地的地方（看到哪条换哪条）
      if (atomId) {
        const patch = { gloss: result.context.gloss, support_lang: supportLang };
        // `gloss_pos` 是迁移 0008 的列。**迁移还没跑时退一步不带它写** ——
        // 少一个词性标签，总好过整个查词功能等着他去粘一段 SQL 才能用
        // （和 `/api/atoms` 对 `t_s` 的处理同一个套路）。
        const { error: e1 } = await supabase
          .from("atoms")
          .update({ ...patch, gloss_pos: result.context.pos })
          .eq("id", atomId)
          .eq("user_id", user.id);
        if (e1) {
          await supabase.from("atoms").update(patch).eq("id", atomId).eq("user_id", user.id);
        }
      }
    }

    if (!cacheHit) {
      senses = result.senses;
      sensesStatus = senses.length > 0 ? "ok" : "none";
      // **空数组也要存**：不存的话，"这个词确实没有别的义项"每次都要重新问一遍模型 ——
      // 一个稳定的否定答案，白付一辈子的钱
      // 表是迁移 0008 建的。**没跑迁移就静静地存不进去**（Supabase 返回 error 而不是抛），
      // 功能照常可用，只是每次都要重新问一遍模型 —— 缓存是省钱的，不是能不能用的前提
      if (supportLang && contentLang) {
        await supabase
          .from("word_senses")
          .upsert(
            { term: key, content_lang: contentLang, support_lang: supportLang, senses },
            { onConflict: "term,content_lang,support_lang" },
          );
      }
    }
  } catch (e) {
    // D44：**结局要分得开**。没配 key / 超时 / 模型给了不能用的东西，是三句不同的话
    const message =
      e instanceof PhraseError
        ? e.message
        : e instanceof Error && e.name === "TimeoutError"
          ? t("err.lookupTimeout")
          : t("err.lookupFailed");
    // 语境意思要是本来就在库里，**别因为义项没查成就把它一起吞掉** ——
    // 有一半总比一片空白强，剩下那一半如实说没查到 + 给人点的重试
    if (context) {
      return NextResponse.json({
        term,
        context,
        senses: [],
        supportLang,
        sensesStatus: "failed",
        error: message,
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ term, context, senses, supportLang, sensesStatus });
}

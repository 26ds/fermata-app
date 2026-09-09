import { NextResponse } from "next/server";
import { z } from "zod";
import { sameLang, studyMode } from "@/lib/lang";
import { detectContentLang } from "@/lib/lang-detect";
import { PhraseError, scanPhrases } from "@/lib/phrases/gemini-phrases";
import { headOf, isPhraseScan, type PhraseScan } from "@/lib/phrases/types";
import { getLangPrefs } from "@/lib/settings";
import { resolveContentLang } from "@/lib/text-script";
import { conformSegments } from "@/lib/zh-convert";
import { captionScriptFor } from "@/lib/zh-script";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow, TranscriptSegment } from "@/lib/types";
import { getT } from "@/lib/ui-lang";

// M3.7 词库 —— 整片扫一次的唯一入口（D40 + D42）。**懒触发**：第一次在这片子里
// 暂停时前端后台打一次，不看的片子一分钱不花。
//
// 五种回法，前端照着走：
//   not-ready   字幕还没转完 —— **不扫**。扫一半将来要重扫，等于付两次钱
//   running     另一次扫描正在跑（并发锁）—— 别重复开工
//   need-target 还没问过他"想学这门语言还是只想搞懂内容" —— 先问，再来
//   partial     预算用完了，扫到一半 —— 前端再打一次接着扫（不重扫已扫的）
//   ready       扫完了（或本来就扫过 —— **这一路一分钱不花**，验收⑤靠它）

export const maxDuration = 300;

/** 软预算。到点把已扫的存下来收工，剩下的下次接着扫 */
const BUDGET_MS = 150_000;

/** 并发锁多久算死锁（上一次跑到一半函数被掐了，不能永远锁着） */
const LOCK_STALE_MS = 5 * 60_000;

/** 字幕还没转完时，至少要有这么多段才值得扫（转写刚起步就扫等于白花一次） */
const MIN_SEGMENTS_FOR_PARTIAL = 20;

const schema = z.object({
  sourceId: z.string().uuid(),
  /**
   * 用户按了「再扫一次」。**破锁 + 无视已存的结果，从头重扫。**
   * 这是花钱的动作，所以只由人显式触发，代码自己永远不传 true ——
   * 但必须有：上一次扫崩在半路会留下一个 5 分钟的锁，没有这条路人就只能干等。
   */
  force: z.boolean().optional(),
});

/** `running@<ISO>` —— 锁和时间戳挤在同一个 text 列里，**零新字段**（0007 不用重跑） */
function lockAge(status: string | null | undefined): number | null {
  if (!status?.startsWith("running@")) return null;
  const at = Date.parse(status.slice("running@".length));
  return Number.isFinite(at) ? Date.now() - at : 0;
}

export async function POST(request: Request) {
  const t = await getT();
  if (!supabaseConfigured) return NextResponse.json({ error: t("err.noSupabase") }, { status: 500 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("err.badRequest") }, { status: 400 });
  const { sourceId, force } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: t("err.needLogin") }, { status: 401 });

  // select("*")：`phrases` / `phrases_status` 是迁移 0007 的列，点名查会在没跑迁移的库上整条炸掉
  const { data } = await supabase
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: t("err.noSource") }, { status: 404 });
  const source = data as SourceRow;

  const raw: TranscriptSegment[] = Array.isArray(source.transcript) ? source.transcript : [];
  const captionsReady = source.transcript_status === "ready";

  // D40 原话是"字幕转好了才扫"，理由是扫一半将来要重扫 = 付两次钱。
  // **M3.7 真机第一轮改了这条**：字幕停在 partial 是很常见的状态（转到一半退出、
  // 长内容分轮转），死等 ready 会让整个词库功能在这些片子上**永远不出现**，
  // 而且什么都不说。真正该解决的是"别付两次钱"，那靠续扫（`scannedThrough` + `head`）
  // 就够了 —— 字幕后来长长了，只扫新长出来的那截。
  //
  // 只挡两种：一段字幕都没有；以及刚开头那几句（转写刚起步，扫了也没意义还占一次锁）。
  if (raw.length === 0 || (!captionsReady && raw.length < MIN_SEGMENTS_FOR_PARTIAL)) {
    return NextResponse.json({ status: "not-ready" });
  }

  const prefs = await getLangPrefs(supabase, user.id);
  // D50：**必须**在扫之前调好字形。扫出来的词组要拿去和屏幕上那份字幕逐字对齐
  // （`resolvePhrases` / `findTerms` 都是纯字符串匹配）—— 一边繁一边简，一条也对不上，
  // 高亮会整片消失，而且不会报错。
  const segments = conformSegments(raw, captionScriptFor(prefs));

  // 内容语言：播客走转写时模型顺手就报了；**YouTube 粘贴字幕那条路一个字没经过模型**，
  // 这里补一次（一支内容一辈子一次，约 500 token）。写回失败不影响这次扫描。
  // D51：库里那个标签先跟正文对一眼 —— 2026-07-31 之前导入的内容一律躺着一个假 `'en'`，
  // 不核对的话这里会把中文视频判成英文内容，词库标错、注释也用错语言。
  const resolved = resolveContentLang(source.content_lang, segments.slice(0, 40).map((s) => s.text).join(""));
  let contentLang = resolved.lang ?? "";
  if (resolved.corrected) {
    await supabase.from("sources").update({ content_lang: contentLang || null }).eq("id", sourceId).eq("user_id", user.id);
  }
  if (!contentLang) {
    contentLang = await detectContentLang(segments);
    if (contentLang) {
      await supabase
        .from("sources")
        .update({ content_lang: contentLang })
        .eq("id", sourceId)
        .eq("user_id", user.id);
    }
  }

  // D42：**只问一句**。内容不是他母语、又还没问过他想不想学这门语言 —— 先问，别瞎标。
  // 母语都还不知道时不问（问了也没法判断），退回默认模式照常扫。
  if (
    prefs.targetLang === null &&
    prefs.nativeLang &&
    contentLang &&
    !sameLang(contentLang, prefs.nativeLang)
  ) {
    return NextResponse.json({ status: "need-target", contentLang });
  }

  const mode = studyMode(contentLang, prefs.nativeLang, prefs.targetLang);
  const existing = isPhraseScan(source.phrases) ? (source.phrases as PhraseScan) : null;
  const head = headOf(segments);

  // 这份旧结果还能不能接着用：模式没变（改了目标语言该标的东西就变了）+ 字幕是**同一份**
  // （开头没变、且只多不少 —— 字幕转到一半会继续往后长，那是正常的；变短或换头
  // 说明整份被替换了，只能从头重扫）。旧数据没存 head 的按老规矩要求长度完全一致。
  const sameCaptions = existing
    ? existing.head
      ? existing.head === head && existing.segCount <= segments.length
      : existing.segCount === segments.length
    : false;
  const reusable = !force && existing && existing.mode === mode && sameCaptions ? existing : null;

  // 已经把**当前这份**字幕扫完了就直接给 —— 重看同一支不再花钱（验收⑤）
  if (reusable && reusable.scannedThrough >= segments.length) {
    return NextResponse.json({ status: "ready", phrases: reusable, count: reusable.items.length });
  }

  // 并发锁：连点两下暂停、或两个标签页同时开着，不该付两次钱。
  // 「再扫一次」能破锁 —— 上一次扫崩在半路会留下一个锁，没有破锁的路人就只能干等 5 分钟
  const age = lockAge(source.phrases_status);
  if (!force && age !== null && age < LOCK_STALE_MS) {
    return NextResponse.json({ status: "running" });
  }

  // 接着扫哪儿：能复用就从上次停下的地方续（字幕后来长长的那截才要花钱）；否则从头来。
  // 强制重扫一律从 0 开始 —— 人点「再扫一次」就是因为上次那份不对
  const resumable = reusable;
  const from = resumable?.scannedThrough ?? 0;

  const lockValue = `running@${new Date().toISOString()}`;
  const { error: lockError } = await supabase
    .from("sources")
    .update({ phrases_status: lockValue })
    .eq("id", sourceId)
    .eq("user_id", user.id);
  // 上锁失败多半是迁移没跑。照样扫（这一次能看到高亮），只是存不下来
  const persistable = !lockError;

  const startedAt = Date.now();
  let scanned: { items: PhraseScan["items"]; scannedThrough: number };
  try {
    scanned = await scanPhrases({
      segments,
      from,
      mode,
      contentLang,
      nativeLang: prefs.nativeLang,
      targetLang: prefs.targetLang ?? "",
      remainingMs: () => BUDGET_MS - (Date.now() - startedAt),
    });
  } catch (e) {
    if (persistable) {
      await supabase
        .from("sources")
        .update({ phrases_status: "failed" })
        .eq("id", sourceId)
        .eq("user_id", user.id);
    }
    const message = e instanceof PhraseError ? e.message : t("err.phraseScanFailed");
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const scan: PhraseScan = {
    v: 1,
    mode,
    contentLang,
    supportLang: prefs.nativeLang,
    segCount: segments.length,
    head,
    scannedThrough: scanned.scannedThrough,
    scannedAt: new Date().toISOString(),
    items: [...(resumable?.items ?? []), ...scanned.items],
  };
  // 「扫完了」= 这一份字幕扫到底了 **且** 字幕本身也转完了。
  // 字幕还在长的时候标 partial，下次进来只扫新长出来的那截（不重复付费）
  const complete = scan.scannedThrough >= scan.segCount && captionsReady;

  let persisted = false;
  if (persistable) {
    const { error } = await supabase
      .from("sources")
      .update({ phrases: scan, phrases_status: complete ? "ready" : "partial" })
      .eq("id", sourceId)
      .eq("user_id", user.id);
    persisted = !error;
  }

  return NextResponse.json({
    status: complete ? "ready" : "partial",
    phrases: scan,
    count: scan.items.length,
    // 存不下来要说实话：这一次看得到高亮，下次进来还得重扫（会再花一次钱）
    persisted,
  });
}

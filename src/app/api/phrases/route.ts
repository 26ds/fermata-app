import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeLang, sameLang, studyMode } from "@/lib/lang";
import { detectContentLang, PhraseError, scanPhrases } from "@/lib/phrases/gemini-phrases";
import { isPhraseScan, type PhraseScan } from "@/lib/phrases/types";
import { getLangPrefs } from "@/lib/settings";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow, TranscriptSegment } from "@/lib/types";

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

const schema = z.object({ sourceId: z.string().uuid() });

/** `running@<ISO>` —— 锁和时间戳挤在同一个 text 列里，**零新字段**（0007 不用重跑） */
function lockAge(status: string | null | undefined): number | null {
  if (!status?.startsWith("running@")) return null;
  const at = Date.parse(status.slice("running@".length));
  return Number.isFinite(at) ? Date.now() - at : 0;
}

export async function POST(request: Request) {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  const { sourceId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  // select("*")：`phrases` / `phrases_status` 是迁移 0007 的列，点名查会在没跑迁移的库上整条炸掉
  const { data } = await supabase
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "找不到这条内容" }, { status: 404 });
  const source = data as SourceRow;

  const segments: TranscriptSegment[] = Array.isArray(source.transcript) ? source.transcript : [];
  // D40：**字幕转好了才扫**。转到一半就扫，后半截将来还得再扫一遍 —— 同一支付两次钱
  if (source.transcript_status !== "ready" || segments.length === 0) {
    return NextResponse.json({ status: "not-ready" });
  }

  const prefs = await getLangPrefs(supabase, user.id);

  // 内容语言：播客走转写时模型顺手就报了；**YouTube 粘贴字幕那条路一个字没经过模型**，
  // 这里补一次（一支内容一辈子一次，约 500 token）。写回失败不影响这次扫描。
  let contentLang = normalizeLang(source.content_lang);
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

  // 已经扫好了就直接给 —— 重看同一支不再花钱（验收⑤）。
  // 三个条件都要满足：扫完了、字幕没换过、模式没变（他改了目标语言，该标的东西就变了）。
  if (
    existing &&
    existing.scannedThrough >= existing.segCount &&
    existing.segCount === segments.length &&
    existing.mode === mode
  ) {
    return NextResponse.json({ status: "ready", phrases: existing });
  }

  // 并发锁：连点两下暂停、或两个标签页同时开着，不该付两次钱
  const age = lockAge(source.phrases_status);
  if (age !== null && age < LOCK_STALE_MS) {
    return NextResponse.json({ status: "running" });
  }

  // 接着扫哪儿：字幕没换过、模式没变，就从上次停下的地方续；否则从头来
  const resumable =
    existing && existing.segCount === segments.length && existing.mode === mode ? existing : null;
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
    const message = e instanceof PhraseError ? e.message : "这次没扫出词组，稍后再试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const scan: PhraseScan = {
    v: 1,
    mode,
    contentLang,
    supportLang: prefs.nativeLang,
    segCount: segments.length,
    scannedThrough: scanned.scannedThrough,
    scannedAt: new Date().toISOString(),
    items: [...(resumable?.items ?? []), ...scanned.items],
  };
  const complete = scan.scannedThrough >= scan.segCount;

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
    // 存不下来要说实话：这一次看得到高亮，下次进来还得重扫（会再花一次钱）
    persisted,
  });
}

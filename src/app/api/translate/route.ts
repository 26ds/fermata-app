import { NextResponse } from "next/server";
import { z } from "zod";
import { langLabel, normalizeLang } from "@/lib/lang";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getCachedTranslation, putCachedTranslation } from "@/lib/translate/cache";
import { translateSegments, TranslateError, type TranslateProgress } from "@/lib/translate/gemini-translate";
import { isSupportedLang } from "@/lib/translate/langs";
import type { SourceRow, TranscriptSegment } from "@/lib/types";
import { getLangPrefs } from "@/lib/settings";
import { detectContentLang } from "@/lib/lang-detect";
import { dominantScript, mightBeSameLang, resolveContentLang } from "@/lib/text-script";
import { conformSegments, scriptOfText } from "@/lib/zh-convert";
import { displayedHanScript, hanScriptOf } from "@/lib/zh-script";

// M2.9 双语字幕 —— 把一条已有字幕翻成目标语言的唯一入口。
//
// 形态照抄 /api/transcript：**流式 NDJSON**（翻一批推一批，用户看着译文长出来），
// (content_key, target_lang) 命中缓存则一次性吐、零成本零延迟；翻完整才回填缓存。
// 与字幕不同的是：译文不在 sources 上占状态列 —— 它是叠在字幕上的第二层，
// 客户端自己拿着显示，所以这条路只管「翻 + 缓存」，不写 source。

export const maxDuration = 300;

/** 软预算：留 60 秒收尾，绝不贴着 300 秒硬墙跑 */
const BUDGET_MS = 240_000;

const bodySchema = z.object({
  sourceId: z.string().uuid(),
  targetLang: z.string().min(2).max(12),
});

const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
} as const;

function line(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

function ndjsonOnce(payloads: unknown[]): Response {
  const text = payloads.map((p) => `${JSON.stringify(p)}\n`).join("");
  return new Response(text, { headers: NDJSON_HEADERS });
}

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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  }
  const { sourceId, targetLang } = parsed.data;
  if (!isSupportedLang(targetLang)) {
    return NextResponse.json({ error: "不支持的目标语言" }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "找不到这条内容" }, { status: 404 });
  }

  const source = row as SourceRow;
  const segments: TranscriptSegment[] = Array.isArray(source.transcript) ? source.transcript : [];
  if (segments.length === 0) {
    return NextResponse.json(
      { error: "这条内容还没有字幕，先生成字幕再翻译。" },
      { status: 400 },
    );
  }

  const contentKey = source.external_id;
  const targetScript = hanScriptOf(targetLang);
  const sample = segments.slice(0, 40).map((s) => s.text).join("");

  // **D51：这个标签可能是假的，用之前先跟正文对一眼。**
  // `sources.content_lang` 的数据库默认值是 `'en'`，而导入时显式写 `null` 是
  // 2026-07-31 才加的 —— **在那之前导入的每一条内容都躺着一个 `'en'`，包括满屏中文的**。
  // 后果正是 2026-08-07 真机报的那个：中文视频要英文译文，被判成"原文就是英语"，
  // 静默不翻。语言标签会撒谎，**正文用的是哪套文字不会**。
  const resolved = resolveContentLang(source.content_lang, sample);
  let sourceLang = resolved.lang;
  let heal = resolved.corrected;

  // === 省钱闸：掏钱之前先确认「这不是同一门语言」（2026-08-08 真机报的）===
  //
  // 上面那一步只在**正文那套文字能定死一门语言**时给得出答案（假名=日语、谚文=韩语…），
  // 而 YouTube 那条路 `content_lang` 本来就一直空着。两件事撞在一起的后果是：
  // 一支英语视频点「译文=English」，这里判不出原文是英语，于是老老实实付钱
  // 把英语"翻"成英语 —— 几百段字幕，一分钱不该花。
  //
  // 所以判不出来时先问一句：**约 500 token，一支内容一辈子一次**（问完写回库里，
  // 下次连这一句都省了），挡掉的是整篇的翻译费。
  //
  // **只在"有可能是同一门语言"时才问**：正文和目标语言连文字都不是一套
  // （中文字幕要英文译文），不用问也知道不同，别为这个多花 500 token、多等一秒。
  if (!sourceLang && mightBeSameLang(sample, targetLang)) {
    const detected = await detectContentLang(segments);
    if (detected) {
      sourceLang = detected;
      heal = true;
    }
    // 问不出来（超时 / 没配 key / 模型胡说）就照旧翻 ——
    // **宁可多花一次钱，也不能把该翻的判成不翻**：那是用户点了没反应，更糟。
  }

  if (heal) {
    // 顺手把库里那一行治好 —— 不然词库标什么、AI 用哪门语言解释，全都还按那个假标签来；
    // 而且下次再点译文又要重问一遍。治不好也不该挡住这一次翻译，所以不 await、错了也不管。
    //
    // **中文一律写 `zh-Hans`，不在这儿判简繁**（`normalizeLang` 的既定归一，D42）。
    // 试过在这里用 `scriptOfText` 判准再写，**放弃了**，两条理由：
    //   ⑴ 另外两个写这一列的地方（`/api/transcript` 从 Whisper 报的语言写、`/api/phrases`）
    //      都写 `zh-Hans`，只有这儿写 `zh-Hant` 会让同一支内容的这一列来回翻烙饼；
    //   ⑵ **更根本的是 D50 已经定了：字形是读侧的事，不是内容的属性** ——
    //      库里存哪套由转写模型随手挑，屏幕上是哪套由看的人的语言定。
    //      `content_lang` 回答的是"这是哪门语言"，让它兼职回答"哪套字形"本身就是错位。
    void supabase
      .from("sources")
      .update({ content_lang: sourceLang })
      .eq("id", sourceId)
      .eq("user_id", user.id);
  }

  // 目标语言就是原文语言 —— 不用翻，让客户端只显示原文。
  // **中文不在此列**（`!targetScript`）：中文里"同一门语言"还分两套字形，
  // 这一句会把「屏幕上是简体、他要繁体」误判成不用翻。中文交给下面那段。
  //
  // **D44：把判断说出口。** 原来这里只回一句"原文就是这个语言"，
  // 判错了用户根本看不出来 —— 上面那个假 `'en'` 就是这么藏了一个多星期的。
  if (!targetScript && sourceLang && sourceLang === normalizeLang(targetLang)) {
    return ndjsonOnce([
      {
        type: "same-language",
        lang: targetLang,
        sourceLang,
        note: `这条内容的原文我判断就是${langLabel(sourceLang)}，跟你选的译文是同一门语言 —— 没翻，也没花那笔翻译的钱。`,
      },
    ]);
  }

  // === 中文 → 中文：换字形，不是翻译（D50） ===
  //
  // **这里原来写着"精确比较，不用 sameLang，因为简体→繁体是真的要转换的"。那条已作废。**
  // 2026-08-07 真机量到的后果：把一份繁体字幕连同「翻成简体中文」的指令丢给 Gemini，
  // 它认为中文翻中文无事可做，**原样抄回来**（只把半角逗号改成全角）。
  //
  // 认"是不是中文"要多一层：`content_lang` 对 YouTube **基本都是 null**
  // （`gemini-youtube` 从不报语言），所以原文语言不知道时看字幕本身像不像中文。
  const sourceIsChinese = sourceLang
    ? sourceLang.startsWith("zh")
    : dominantScript(sample) === "han";

  if (targetScript && sourceIsChinese) {
    // 比的是**屏幕上那份**（读侧转换已按他的语言调过），不是库里存的那份 ——
    // 他那支视频库里是繁体、屏幕上是简体，两者不分开就会判错。
    const displayScript = displayedHanScript(
      await getLangPrefs(supabase, user.id),
      scriptOfText(sample),
    );
    if (displayScript === targetScript) {
      return ndjsonOnce([
        {
          type: "same-language",
          lang: targetLang,
          // 屏幕上那份就是这套字形 —— 对选择器来说，这一项就是「原文」
          sourceLang: targetLang,
          note: `你现在看的字幕已经是${langLabel(targetLang)}了。`,
        },
      ]);
    }

    // **两个方向都免费**（D50 三轮，OpenCC 词库）—— 查表、瞬时、不问模型。
    // 库里存的那份本来就是他要的那套时，`conformSegments` 连字符串都不重建。
    const conformed = conformSegments(segments, targetScript);
    const translations = conformed.map((s, i) => ({ i, start: s.start, text: s.text }));
    return ndjsonOnce([
      { type: "start", total: translations.length, existing: translations.length, cached: true },
      { type: "done", complete: true, translations, cached: true },
    ]);
  }

  // === 缓存优先：(内容, 语言) 别人翻过就直接白拿 ===
  if (contentKey) {
    const cached = await getCachedTranslation(supabase, contentKey, targetLang);
    if (cached) {
      return ndjsonOnce([
        { type: "start", total: cached.translations.length, existing: cached.translations.length, cached: true },
        { type: "done", complete: true, translations: cached.translations, cached: true },
      ]);
    }
  }

  const startedAt = Date.now();
  const remainingMs = () => BUDGET_MS - (Date.now() - startedAt);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: unknown) => {
        try {
          controller.enqueue(line(payload));
        } catch {
          /* 浏览器已经走了，不影响服务端把活干完（翻完还要回填缓存） */
        }
      };

      push({ type: "start", total: segments.length, existing: 0 });

      try {
        const result = await translateSegments({
          segments,
          targetLang,
          remainingMs,
          onPartial: async (progress: TranslateProgress) => {
            push({ type: "partial", ...progress });
          },
        });

        // 翻完整了才写回缓存，给后来人白拿（半截的会坑下一个人）
        if (result.complete && contentKey) {
          await putCachedTranslation(supabase, contentKey, targetLang, result.translations, sourceLang);
        }
        push({
          type: "done",
          complete: result.complete,
          translations: result.translations,
          note: result.note ?? null,
        });
      } catch (e) {
        // 该讲给用户听的原因（额度/限流/没字幕）→ 原样告诉他；其它异常也说人话
        const message =
          e instanceof TranslateError
            ? e.message
            : `翻译时出错了：${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
        push({ type: "error", message });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

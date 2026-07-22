import { NextResponse } from "next/server";
import { translateSegments } from "@/lib/translate/gemini-translate";
import type { TranscriptSegment } from "@/lib/types";

// 一次性探针（M2.9a，验完即删）：验 translateSegments 这层 wrapper ——
// 批量切分 + 三路并行 + 按编号合并回填 + 缺号重试 + 预算收尾。
// 裸 prompt 的对齐已在 tr-probe 验过；这一枪验的是把它包起来的那套逻辑。
// 150 句 → 强制切 3 批（60/60/30）→ 走满并行，验合并后仍严格对齐、complete=true。
//
// curl 'https://fermata-eta.vercel.app/api/lab/tr2-probe?lang=en'

export const maxDuration = 120;

const BASE = [
  "今天我们聊聊《百年孤独》这本书。",
  "对。",
  "它的开头是文学史上最好的开头之一。",
  "多年以后，面对行刑队，上校将会回想起。",
  "回想起什么？",
  "回想起父亲带他去见识冰块的那个下午。",
  "嗯。",
  "这一句里同时有三个时间：现在、未来、过去。",
  "所以很多人第一次读会觉得晕。",
  "因为名字都很像，全叫奥雷里亚诺。",
  "哈哈哈。",
  "这其实是故意的。",
  "家族在不断重复自己的命运。",
  "孤独的循环。",
  "对。",
  "那你觉得主题到底是什么？",
  "我觉得是孤独，但不是平常那种。",
  "怎么说？",
  "是和时间对抗又必然失败的孤独。",
  "上校打了三十二场内战，全失败了。",
  "然后一直在做小金鱼，做好熔掉再做。",
  "这个动作本身就是隐喻。",
  "还有那场下了四年多的大雨。",
  "四年十一个月零两天。",
  "越荒诞的事他写得越精确。",
  "最后马孔多被一阵风刮走了。",
  "读完会有点怅然若失。",
  "所以一定要读原著。",
  "范晔那个译本非常好。",
  "好，今天就聊到这里。",
];

export async function GET(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ ok: false, error: "no GEMINI_API_KEY" }, { status: 500 });
  }
  const lang = new URL(request.url).searchParams.get("lang") ?? "en";

  // 150 句：BASE 重复 5 遍，起点秒递增（模拟真实字幕）
  const segments: TranscriptSegment[] = [];
  for (let r = 0; r < 5; r++) {
    for (let k = 0; k < BASE.length; k++) {
      const idx = r * BASE.length + k;
      segments.push({ start: idx * 4, end: idx * 4 + 4, text: BASE[k] });
    }
  }

  const t0 = Date.now();
  let partials = 0;
  try {
    const result = await translateSegments({
      segments,
      targetLang: lang,
      remainingMs: () => 200_000, // 预算充足，验完整路
      onPartial: async () => {
        partials += 1;
      },
    });

    // 对齐检查：下标应 0..N-1 严格递增、不缺不重
    const idx = result.translations.map((t) => t.i);
    const missing: number[] = [];
    for (let i = 0; i < segments.length; i++) if (!idx.includes(i)) missing.push(i);
    const monotonic = idx.every((v, i) => i === 0 || v > idx[i - 1]);
    // start 是否跟着字幕对上（合并没错位）
    const startOk = result.translations.every((t) => t.start === t.i * 4);

    return NextResponse.json({
      ok: true,
      lang,
      inCount: segments.length,
      outCount: result.translations.length,
      complete: result.complete,
      aligned: result.translations.length === segments.length && missing.length === 0,
      monotonic,
      startOk,
      missing: missing.slice(0, 20),
      partials,
      elapsedMs: Date.now() - t0,
      head: result.translations.slice(0, 3).map((t) => ({ i: t.i, start: t.start, text: t.text })),
      tail: result.translations.slice(-3).map((t) => ({ i: t.i, start: t.start, text: t.text })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

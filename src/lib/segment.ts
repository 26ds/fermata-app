import { normalizeLang } from "@/lib/lang";

// M3.10 手动选词 —— 把一行字幕切成「点得动的块」的纯函数（D45 + D42 + D24）。
//
// 为什么需要它：手动选词的动作是**点两下选一段**（点第一块、点第二块，取中间整段）。
// 要能点，就得先有块。而一块是什么，**取决于这条内容是什么语言** ——
// 英文按空格分词，中文日文泰文没有空格、得按词法切。D42 的红线在这里落地：**不许假设英文**。
//
// **D24：这份客户端要用**（字幕层是 250ms 的热路径），一行服务端依赖都不许有。
// `normalizeLang` 是纯函数，安全。

/** 一行字幕切出来的一块 */
export interface Block {
  /** 相对整行的字符起点（含） */
  start: number;
  /** 相对整行的字符终点（不含） */
  end: number;
  /** 这一块的原文 —— **一字不差照抄**，不做大小写/标点归一（D45：他划的就是他要的） */
  text: string;
  /**
   * 点得动吗。纯标点、纯空白 = 点不动（摆一排点不动的空格只会让人点岔）。
   * **但选区跨过它们时照样包含** —— 选 "hang in there" 不该把中间的空格丢掉。
   */
  selectable: boolean;
}

/** 怎么切出来的。`char` = 逐字回落，渲染时块很窄，**要撑最小触控宽度** */
export type SegmentMode = "word" | "char";

export interface LineBlocks {
  blocks: Block[];
  mode: SegmentMode;
}

const EMPTY: LineBlocks = { blocks: [], mode: "word" };

/** 有字母或数字才算"点得动"。`\p{L}` 收得下中日韩、阿拉伯、天城文…… 不是只有 A–Z */
const HAS_LETTER = /[\p{L}\p{N}]/u;

/**
 * 一行里少于两块能点的，"点两下选一段"就退化成"只能整行全选"，等于没有这个功能。
 * 但短句（"Hello."）本来就该只有一块，所以只有**行还挺长、却切不开**时才判定为切失败。
 */
const MIN_SELECTABLE = 2;
const LONG_ENOUGH_TO_SPLIT = 12;

// `Intl.Segmenter` 构造不便宜，而字幕层每 250ms 走一趟 —— 按 locale 缓存住。
// 值允许是 null：这个引擎压根没有 Segmenter，记下来免得每行都试一遍。
const WORD_SEGMENTERS = new Map<string, Intl.Segmenter | null>();
let graphemeSegmenter: Intl.Segmenter | null | undefined;

function hasSegmenter(): boolean {
  return typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
}

/**
 * 这门语言的分词器。
 *
 * **语言不知道就传 `undefined` 用宿主默认 locale，不是回落到逐字。**
 * 2026-08-04 实测（node 24 的 ICU，和浏览器同一套）：locale 传 `"en"` 照样把
 * 中文、日文、泰文按词切得干干净净 —— ICU 对 CJK/泰文走的是词典，跟 locale 几乎无关，
 * locale 只影响极少数语言的裁剪规则。所以「不知道内容语言」远远不到要逐字的地步；
 * 真逐字的话，英文内容会被切成一个个字母，那是明显更糟的交互。
 * （冻结计划里写的是"content_lang 未知就逐字"，这里按实测放宽了，理由记在 M3.10-log。）
 */
function wordSegmenter(contentLang: string | null | undefined): Intl.Segmenter | null {
  if (!hasSegmenter()) return null;
  // 先归一：转写模型报的是 "english" 这种全称，直接喂给 Intl 会抛 RangeError
  const code = normalizeLang(contentLang);
  const key = code || "und";
  const hit = WORD_SEGMENTERS.get(key);
  if (hit !== undefined) return hit;

  let seg: Intl.Segmenter | null = null;
  try {
    seg = new Intl.Segmenter(code || undefined, { granularity: "word" });
  } catch {
    // 这个码 Intl 不认（`normalizeLang` 认不出的东西是原样奉还的，可能是一整句人话）。
    // 退回宿主默认 locale **再试一次** —— 见上，locale 对分词影响很小，
    // 为一个写坏的语言码就整行逐字，代价远大于收益
    try {
      seg = new Intl.Segmenter(undefined, { granularity: "word" });
    } catch {
      seg = null;
    }
  }
  WORD_SEGMENTERS.set(key, seg);
  return seg;
}

/** 逐字回落用的字素分词器。**按字素而不是按码位** —— 别把 emoji 或带音标的字母劈成两半 */
function graphemeSegmenterOf(): Intl.Segmenter | null {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter;
  if (!hasSegmenter()) {
    graphemeSegmenter = null;
    return null;
  }
  try {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch {
    graphemeSegmenter = null;
  }
  return graphemeSegmenter;
}

function charBlocks(text: string): Block[] {
  const out: Block[] = [];
  const push = (s: string, start: number) => {
    out.push({ start, end: start + s.length, text: s, selectable: HAS_LETTER.test(s) });
  };

  const g = graphemeSegmenterOf();
  if (g) {
    for (const s of g.segment(text)) push(s.segment, s.index);
    return out;
  }
  // 连 `Intl.Segmenter` 都没有的引擎：按码位切。`Array.from` 至少不会把 emoji 劈开
  let i = 0;
  for (const ch of Array.from(text)) {
    push(ch, i);
    i += ch.length;
  }
  return out;
}

/** 切完了但等于没切 —— 这一行还挺长，却只切出不到两块能点的 */
function splitFailed(text: string, blocks: Block[]): boolean {
  if (text.replace(/\s+/g, "").length <= LONG_ENOUGH_TO_SPLIT) return false;
  let n = 0;
  for (const b of blocks) {
    if (b.selectable && ++n >= MIN_SELECTABLE) return false;
  }
  return true;
}

/**
 * 把一行字幕切成可点的块。
 *
 * ⚠️ **调用方必须 `useMemo` 挂在行文本上**：字幕层 250ms 一跳，每帧重切会把手机烤热。
 */
export function segmentLine(text: string, contentLang: string | null | undefined): LineBlocks {
  if (!text) return EMPTY;

  const seg = wordSegmenter(contentLang);
  if (seg) {
    const blocks: Block[] = [];
    for (const s of seg.segment(text)) {
      blocks.push({
        start: s.index,
        end: s.index + s.segment.length,
        text: s.segment,
        // `isWordLike` 是 ICU 自己的判断，比正则准 —— "don't"、"100.5" 它都当一块词。
        // 老引擎上它可能是 undefined，那就退回看有没有字母/数字
        selectable: s.isWordLike ?? HAS_LETTER.test(s.segment),
      });
    }
    if (!splitFailed(text, blocks)) return { blocks, mode: "word" };
  }
  return { blocks: charBlocks(text), mode: "char" };
}

/** 一行里某个词出现的位置 */
export interface TermSpan {
  start: number;
  end: number;
  term: string;
}

/**
 * 这一行里，哪些位置是**已经收进词库的词**。
 *
 * 为什么要反着找：AI 标出来的词自带坐标（`PhraseItem.start`），
 * 手动划的没有 —— 词库里只存了原文。要让他下次回看时还认得出"这个我收过"，
 * 就只能拿词回字幕里找。
 *
 * **长的词先占位**：收了 "machine learning" 又收了 "learning" 时，
 * 先标长的，短的落进已占区间就跳过 —— 重叠的高亮会画成一坨看不懂的颜色。
 * 同一个词只标**第一次**出现的位置（一行里重复出现是少数，标满反而乱）。
 */
export function findTerms(text: string, terms: Iterable<string>): TermSpan[] {
  const sorted = Array.from(terms)
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  const out: TermSpan[] = [];
  for (const term of sorted) {
    const start = text.indexOf(term);
    if (start < 0) continue;
    const end = start + term.length;
    if (out.some((s) => start < s.end && end > s.start)) continue;
    out.push({ start, end, term });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 这个字符区间落在哪一段里（用来给块上色）。都不落就返回 null */
export function spanAt(spans: TermSpan[], start: number, end: number): TermSpan | null {
  return spans.find((s) => start < s.end && end > s.start) ?? null;
}

/**
 * 点了第 `a` 块、又点了第 `b` 块，选中的是原文的哪一段。
 *
 * **顺序无所谓**（先点后面那个也行，自动取小到大）；**点同一块 = 只要这一个词**。
 * 两块之间的标点空格照样包进来 —— "hang in there" 不该被切成 "hang" + "there"。
 *
 * 返回的 `text` 是从整行里切出来的，**不是把两块的 text 拼起来**：拼接会丢掉中间那些
 * 不可点的块，而它们正是这段话的一部分。下标越界返回 `null`，让调用方当没选中处理。
 */
export function spanOf(
  text: string,
  blocks: Block[],
  a: number,
  b: number,
): { start: number; end: number; text: string } | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo < 0 || hi >= blocks.length) return null;
  const start = blocks[lo].start;
  const end = blocks[hi].end;
  if (end <= start) return null;
  return { start, end, text: text.slice(start, end) };
}

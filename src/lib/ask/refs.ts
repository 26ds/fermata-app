// M3.15 片 c —— D64 的闸：模型说「视频别处还讲到」，**必须连原句一起给**；服务端拿原句去字幕里找，
// 找得到就把秒数吸附到那一句真正开始的地方，找不到就照登、灰着、说「没核对上」（卡片不可点）。
//
// 片 d 的另一半（D65）起还管答案**最后一行**的问题分类 `[[KINDS]] …`：流式时和指路那一段一起挡在屏幕外、答完摘出来存进 `interrupts.kinds`。
//
// 纯函数（不 import server-only）：Node 直接跑得了单元测试（工具箱第 5 / 8 节的办法）。
// 读的是 `/api/ask` 喂给模型的**同一份**字幕（已经过 D50 字形转换）—— 否则简体问句引繁体字幕，永远核不上。
//
// ── 开工前拿生产库里 30 条真指路量出来的（2026-09-18，片 b 那种写在正文里的「后面 MM:SS 还会讲到 “…”」）──
// ① **原句大多是真的，时间常常是错的**：Top Gun 里同一句「Dagger, Comanche, we're picking up two bandits」
//    一个答案说在 02:22、另一个说在 00:30 —— 所以吸附以原句为准，模型写的秒数只拿来在几处同样的句子里挑最近的那一处；
// ② 会改字：「[b]andits are switching course…」（编辑式的方括号）、句尾标点、大小写 —— 比之前先把这些全抹平；
// ③ 会拼：一句原句后面跟一段自己的翻译「（长官，二号和四号僚机落后了。）」、或者用「…」截掉中间 —— 整句对不上时拆开找最长那一段。

import type { AnswerRef } from "@/lib/answer-refs";
import { refsText } from "@/lib/answer-refs";
import { normalizeKinds } from "@/lib/question-kinds";
import type { QuestionKind, TranscriptSegment } from "@/lib/types";

/** 模型在正文后面写的那一行记号。容错：一对或两对方括号、中间空格、markdown 加粗、大小写 */
const MARKER = /\**[ \t]*\[\[?[ \t]*REFS[ \t]*\]\]?[ \t]*\**/i;

/**
 * 片 d 的另一半（D65）：答案**最后一行**的问题分类 `[[KINDS]] knowledge, language`。
 * 容错比 REFS 再宽一点：`KINDS` 后面紧跟收尾的方括号**或者冒号**都算 —— 模型偶尔会写成 `[[KINDS: knowledge]]`，
 * 那种要是认不出来，整行就原样漏到屏幕上（界面上多出一句「[[KINDS: knowledge]]」）。
 * 但**不许光凭 `[kinds` 就算**：正文里写一句「[kinds of jets]」，后面半截答案会被当成记号吞掉。
 */
const KINDS_MARKER = String.raw`\**[ \t]*\[\[?[ \t]*KINDS[ \t]*(?:\]\]?|(?=[:：]))[ \t]*\**[ \t]*[:：]?`;

/** 流式时挡哪几种记号：两种都是「从这儿往后不上屏」 */
const TAIL_MARKER = new RegExp(`${MARKER.source}|${KINDS_MARKER}`, "i");

// ── 〇、问题分类那一行（D65）─────────────────────────────────────────────────

/** 模型可能写成的样子 → 三类之一。它被叫去写英文词，但中文答案里偶尔会顺手翻成中文 */
const KIND_WORDS: Readonly<Record<string, QuestionKind>> = {
  language: "language",
  languages: "language",
  lang: "language",
  linguistic: "language",
  语言: "language",
  語言: "language",
  knowledge: "knowledge",
  content: "knowledge",
  知识: "knowledge",
  知識: "knowledge",
  misheard: "misheard",
  mishear: "misheard",
  missed: "misheard",
  没听清: "misheard",
  沒聽清: "misheard",
};

/** 「一类都不沾」的写法 —— 认得它，才分得清「标签就是没有」和「这一行根本不是标签」 */
const NONE_WORDS = new Set(["none", "null", "nil", "na", "-", "—", "无", "無", "没有", "沒有"]);

function kindTokens(s: string): string[] {
  return s
    .replace(/[[\]"'`*「」“”‘’(){}<>.。!！]/g, " ")
    .toLowerCase()
    .split(/[\s,，、;；/|·+&]+/)
    .filter(Boolean);
}

/** 读一段字里的标签。`pure` = 这一段**只有**标签词（或者「无」），没夹别的话 */
function readKindText(s: string): { kinds: QuestionKind[]; pure: boolean; empty: boolean } {
  const toks = kindTokens(s);
  const kinds: QuestionKind[] = [];
  let pure = true;
  for (const tok of toks) {
    const k = KIND_WORDS[tok];
    if (k) kinds.push(k);
    else if (!NONE_WORDS.has(tok)) pure = false;
  }
  return { kinds: normalizeKinds(kinds), pure, empty: toks.length === 0 };
}

/**
 * 把答案里的 `[[KINDS]] …` 那一行摘出来。**`kinds === null` = 这一趟压根没写那一行**（和「写了、一类都不沾」的 `[]` 分开）。
 *
 * 认的写法：`[[KINDS]] knowledge, language` / `**[[KINDS]]** Knowledge.` / `[KINDS]: 知识` / `[[KINDS: misheard]]` /
 * 记号单独一行、类别写在下一行（下一行**只有**标签词才算，免得把 `[[REFS]]` 或正文吞掉）/ 只有记号（= 一类都不沾）。
 * 写了好几行就合起来。摘掉的只是这几行，前后的正文、`[[REFS]]` 那一段原样留着给后面拆。
 */
export function takeKinds(text: string): { rest: string; kinds: QuestionKind[] | null } {
  const re = new RegExp(KINDS_MARKER, "gi");
  let kinds: QuestionKind[] | null = null;
  let rest = "";
  let from = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const markEnd = m.index + m[0].length;
    const nl = text.indexOf("\n", markEnd);
    let end = nl < 0 ? text.length : nl;
    let got = readKindText(text.slice(markEnd, end));
    if (got.empty && nl >= 0) {
      // 记号单独一行：看下一行非空的是不是一行纯标签
      const next = /^\n[ \t]*\n?([^\n]*)/.exec(text.slice(end));
      const cand = next ? readKindText(next[1]) : null;
      if (next && cand && !cand.empty && cand.pure && !TAIL_MARKER.test(next[1])) {
        got = cand;
        end += next[0].length;
      }
    }
    kinds = normalizeKinds([...(kinds ?? []), ...got.kinds]);
    rest += text.slice(from, m.index);
    from = end;
    re.lastIndex = Math.max(end, markEnd + 1);
  }
  if (kinds === null) return { rest: text, kinds: null };
  return { rest: rest + text.slice(from), kinds };
}

/** 最多收几张卡。提示词里说 3；多给的收到 5 为止 —— 防一堵卡片墙 */
export const MAX_REFS = 5;

/** 整句拿去找：抹平之后至少这么长（「Impact.」= 6 个字母，是真台词，要找得到） */
const MIN_WHOLE = 4;
/** 整句没找到、拆开找其中一段：那一段至少这么长，太短的片段到处都撞得上，不算证据 */
const MIN_PIECE = 8;

// ── 一、把模型的原文拆成「正文」和「指路那一段」 ─────────────────────────────

/** 指路那一段里的一行：`{"t": …}`（行首可能有 `-` / `1.`） */
const JSON_LINE = /^\s*(?:[-*•]|\d+[.)])?\s*\{\s*"t"\s*:/;

/**
 * 正文和指路那一段的分界。标准写法是单独一行 `[[REFS]]`；模型偶尔漏写记号、直接在末尾列 JSON ——
 * 那种也认（末尾连着几行都以 `{"t"` 开头）。
 * 片 d 起先把最后那行问题分类（`[[KINDS]]`，D65）摘出来 —— 它排在指路那一段后面，不摘掉的话「末尾连着几行 JSON」就认不出了；
 * 顺带也保证看画面那一趟（它只拿 `body`）万一写了分类，也不会存进答案里。
 */
export function splitRefsBlock(text: string): { body: string; block: string | null; kinds: QuestionKind[] | null } {
  const { rest, kinds } = takeKinds(text);
  const m = MARKER.exec(rest);
  if (m) return { body: rest.slice(0, m.index).trim(), block: rest.slice(m.index + m[0].length), kinds };
  // 没有记号：从末尾往回数，连着几行都是 `{"t": …}`（中间夹空行也算）就当它是指路那一段
  const lines = rest.trimEnd().split("\n");
  let i = lines.length;
  while (i > 0 && (JSON_LINE.test(lines[i - 1]) || (i < lines.length && !lines[i - 1].trim()))) i--;
  if (i < lines.length && lines.slice(i).some((l) => JSON_LINE.test(l))) {
    return { body: lines.slice(0, i).join("\n").trim(), block: lines.slice(i).join("\n"), kinds };
  }
  return { body: rest.trim(), block: null, kinds };
}

/**
 * 剩下的尾巴会不会是记号的开头（`[`、`[[RE`、`[[KIN`、`**[`、一个空格）——是就先扣着，等下一块来了再说。
 * 片 d 起多认一种：`[[KINDS`（问题分类那一行）—— **它和 `[[REFS]]` 谁先来都得挡住**：
 * 模型这一问没写指路（别处没讲到）时，分类那一行就紧跟在正文后面；只认 REFS 的话它会原样漏上屏
 */
function couldBeMarkerStart(tail: string): boolean {
  const s = tail.replace(/[\s*]/g, "").toUpperCase();
  return s === "" || ["[[REFS]]", "[REFS]", "[[KINDS", "[KINDS"].some((marker) => marker.startsWith(s));
}

/**
 * 流式时把指路那一段（和片 d 的分类那一行）挡在界面外：**记号之前的字照常一块块吐，记号和它后面的一个字都不吐**。
 * 记号可能被切在两块中间（`…\n\n[[RE` + `FS]]\n{…`），所以末尾像记号开头的那一小截先扣着。
 * `end()` 时如果从头到尾没出现记号，扣着的那一截照吐（那只是正文末尾的一个空格或方括号）。
 * 两种记号谁先来就从谁那儿截：提示词要分类在最后一行，但模型把它写在 `[[REFS]]` 前面也不许漏。
 */
export function refsStream(emit: (text: string) => void | Promise<void>) {
  let full = "";
  let sent = 0;
  let cut = false;
  return {
    async push(piece: string) {
      full += piece;
      if (cut) return;
      const m = TAIL_MARKER.exec(full);
      if (m) {
        cut = true;
        if (m.index > sent) await emit(full.slice(sent, m.index));
        sent = m.index;
        return;
      }
      let hold = full.length;
      for (let i = Math.max(sent, full.length - 12); i < full.length; i++) {
        if (couldBeMarkerStart(full.slice(i))) {
          hold = i;
          break;
        }
      }
      if (hold > sent) {
        await emit(full.slice(sent, hold));
        sent = hold;
      }
    },
    async end(): Promise<string> {
      if (!cut && full.length > sent) {
        await emit(full.slice(sent));
        sent = full.length;
      }
      return full;
    },
  };
}

// ── 二、读指路那一段 ─────────────────────────────────────────────────────────

export interface RawRef {
  t: string;
  quote: string;
  note: string;
}

const unescapeJson = (s: string): string => {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\"/g, '"');
  }
};

/**
 * 不是合法 JSON 的那一行，按提示词要的键序（t → quote → note）硬抠。
 * 最常见的坏法是原句里有没转义的双引号（字幕里本来就有引号）：所以每个值先「贪到下一个键为止」，
 * 抠不到再退回严格的写法。
 */
function looseRef(line: string): RawRef | null {
  const order = ["t", "quote", "note"] as const;
  const got = { t: "", quote: "", note: "" };
  order.forEach((key, k) => {
    const next = order[k + 1];
    const greedy = next
      ? new RegExp(`"${key}"\\s*:\\s*"(.*?)"\\s*,\\s*"${next}"\\s*:`)
      : new RegExp(`"${key}"\\s*:\\s*"(.*)"\\s*\\}?\\s*$`);
    const strict = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const m = greedy.exec(line) ?? strict.exec(line);
    if (m) got[key] = unescapeJson(m[1]);
    else if (key === "t") got.t = /"t"\s*:\s*(\d+(?:\.\d+)?)/.exec(line)?.[1] ?? "";
  });
  return got.t || got.quote || got.note ? got : null;
}

function toRaw(o: unknown): RawRef | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const out = { t: s(r.t ?? r.time ?? r.at), quote: s(r.quote ?? r.line ?? r.text), note: s(r.note) };
  return out.t || out.quote || out.note ? out : null;
}

/**
 * 一行一个 JSON（提示词要的写法）；也认一整个 JSON 数组、```json 围栏、行首的 `-` / `1.`。
 * 某一行不是合法 JSON（原句里有没转义的引号）→ 按字段名硬抠一遍，别因为一个引号丢掉整张卡。
 */
export function parseRefsBlock(block: string): RawRef[] {
  const text = block.replace(/```[a-z]*/gi, "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(text);
      if (Array.isArray(arr)) return arr.map(toRaw).filter((r): r is RawRef => r !== null).slice(0, MAX_REFS);
    } catch {
      /* 不是一个完整的数组：往下按行读 */
    }
  }
  const out: RawRef[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim().replace(/,$/, "");
    if (!line.startsWith("{")) continue;
    let r: RawRef | null = null;
    try {
      r = toRaw(JSON.parse(line));
    } catch {
      r = looseRef(line);
    }
    if (r) out.push(r);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

/** 「05:12」「1:02:03」「80:00」（mmss 过了一小时就是 80 分）「312」→ 秒。认不出 = null */
export function parseClock(v: string): number | null {
  const s = v.trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.floor(Number(s));
  const m = /^(?:(\d+):)?(\d+):(\d{1,2})(?:\.\d+)?$/.exec(s);
  if (!m) return null;
  const [, h, mm, ss] = m;
  if (Number(ss) > 59) return null;
  return (h ? Number(h) * 3600 : 0) + Number(mm) * 60 + Number(ss);
}

// ── 三、去字幕里找 ──────────────────────────────────────────────────────────

const KEEP = /[\p{L}\p{N}]/u;

/**
 * 口头语气词：两边都当它不存在。模型抄原句时会顺手删掉 —— 生产库那 30 条里唯一一条没核对上的真原句就是这么来的：
 * 字幕是「And um instead of just showing you… uh I will ask uh language models…」，模型抄成了没有 um / uh 的那一版。
 * 只收英文口语里单独成词、不可能是实词的那几个。
 */
const FILLER = /\b(?:u+m+|u+h+|e+r+m+|a+h+|h+m+|m{2,})\b/gi;

/** 一个字抹平成什么：全角半角、大小写统一，标点空格一律不要（逐字做，这样才能对回原文的位置） */
function flat(ch: string): string {
  let out = "";
  for (const c of ch.normalize("NFKC").toLowerCase()) if (KEEP.test(c)) out += c;
  return out;
}

function flatten(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(FILLER, " ")) out += flat(ch);
  return out;
}

interface CaptionIndex {
  /** 所有字幕抹平后首尾相接（跨行的原句也找得到） */
  hay: string;
  /** hay 的第 k 个字来自第几行、那一行原文的第几个字（UTF-16 下标） */
  seg: number[];
  pos: number[];
  texts: string[];
  starts: number[];
}

function buildIndex(segments: readonly TranscriptSegment[]): CaptionIndex {
  let hay = "";
  const seg: number[] = [];
  const pos: number[] = [];
  const texts: string[] = [];
  const starts: number[] = [];
  segments.forEach((s, si) => {
    const text = (s.text ?? "").normalize("NFC");
    texts.push(text);
    starts.push(s.start);
    // 语气词那几个字不进 hay（位置照记原文的，拿回原文时它们还在 —— 卡片上引的是字幕真正的样子）
    const skip = new Uint8Array(text.length);
    for (const m of text.matchAll(FILLER)) skip.fill(1, m.index, m.index + m[0].length);
    for (let k = 0; k < text.length; ) {
      const cp = text.codePointAt(k)!;
      const ch = String.fromCodePoint(cp);
      if (!skip[k]) {
        for (const c of flat(ch)) {
          hay += c;
          seg.push(si);
          pos.push(k);
        }
      }
      k += ch.length;
    }
  });
  return { hay, seg, pos, texts, starts };
}

/** hay 里 [a, b) 那一段，对回字幕原文（跨行就用空格接上）；句尾紧跟着的标点一起带上 */
function originalSpan(ix: CaptionIndex, a: number, b: number): string {
  const s0 = ix.seg[a];
  const s1 = ix.seg[b - 1];
  const p0 = ix.pos[a];
  const last = ix.texts[s1];
  let p1 = ix.pos[b - 1] + String.fromCodePoint(last.codePointAt(ix.pos[b - 1])!).length;
  while (p1 < last.length && /[.,!?;:…'"”’)\]。，！？；：」』）]/.test(last[p1])) p1++;
  if (s0 === s1) return last.slice(p0, p1).trim();
  const parts = [ix.texts[s0].slice(p0)];
  for (let i = s0 + 1; i < s1; i++) parts.push(ix.texts[i]);
  parts.push(last.slice(0, p1));
  return parts.map((p) => p.trim()).join(" ");
}

/** 模型的原句拆成几段来找：整句优先，再按 `…`、括号里的自注、引号切开，长的先找 */
function candidates(quote: string): { text: string; min: number }[] {
  const pieces = quote
    .split(/…|\.{3}|⋯|[（(][^）)]*[）)]|["“”「」『』]/)
    .map((p) => p.trim())
    .filter((p) => p && p !== quote.trim())
    .sort((x, y) => flatten(y).length - flatten(x).length);
  return [{ text: quote, min: MIN_WHOLE }, ...pieces.map((text) => ({ text, min: MIN_PIECE }))];
}

function findQuote(ix: CaptionIndex, quote: string, claimed: number | null): { seg: number; line: string } | null {
  for (const { text, min } of candidates(quote)) {
    const needle = flatten(text);
    if (needle.length < min) continue;
    const hits: number[] = [];
    for (let at = ix.hay.indexOf(needle); at >= 0; at = ix.hay.indexOf(needle, at + 1)) hits.push(at);
    if (hits.length === 0) continue;
    // 同一句在几处都有（「Copy.」「Impact.」）：挑离模型说的那一秒最近的那一处；它没说秒数就取第一处
    let best = hits[0];
    if (claimed !== null) {
      for (const h of hits) {
        if (Math.abs(ix.starts[ix.seg[h]] - claimed) < Math.abs(ix.starts[ix.seg[best]] - claimed)) best = h;
      }
    }
    return { seg: ix.seg[best], line: originalSpan(ix, best, best + needle.length) };
  }
  return null;
}

/**
 * D64 的三道闸，一次过完：
 * ① 没给原句 → 核不上（只给秒数不算数）；
 * ② 原句在字幕里找得到 → 秒数吸附到那一行的真实起点、卡片可点；找不到 → 照登、灰着、不可点（**不许闷着不给**）；
 * ③ 吸附后必须落在时长以内（字幕行本来就在片子里，这一道只防字幕比片子长的怪数据）。
 * ⚠️ D64 ③ 的后半句「不早于提问那一秒」**没照做**：片 b 修补轮起提示词本来就要「前面讲过」的指路
 * （计划 §B.5 创始人原话是「视频**前后**哪里还讲到」），照做会把真的往前引用灰掉或吞掉 —— 理由记在 M3.15-log 片 c 一节。
 * 同一行字幕只出一张卡（模型偶尔把同一句写两遍）。
 */
export function verifyRefs(
  raws: readonly RawRef[],
  segments: readonly TranscriptSegment[],
  durationS: number | null,
): AnswerRef[] {
  const ix = buildIndex(segments);
  const out: AnswerRef[] = [];
  const used = new Set<number>();
  for (const raw of raws.slice(0, MAX_REFS)) {
    const quote = raw.quote.trim();
    const note = raw.note.trim();
    if (!quote && !note) continue;
    const claimed = parseClock(raw.t);
    const hit = quote ? findQuote(ix, quote, claimed) : null;
    const t = hit ? ix.starts[hit.seg] : null;
    const ok = hit !== null && t !== null && (!durationS || durationS <= 0 || t <= durationS + 1);
    if (ok && hit) {
      if (used.has(hit.seg)) continue;
      used.add(hit.seg);
    }
    out.push({ t_s: ok ? t : null, claimed_s: claimed, quote, line: ok && hit ? hit.line : null, note, ok });
  }
  return out;
}

/**
 * 一趟答完之后：拆出指路那一段 → 核对 → 拼成要落库的全文（正文 + 每张卡一行，见 `answer-refs.ts` 文件头）。
 * 模型这次没写指路 → `refs = []`（和 null 不一样：[] = 按卡片问过、别处没讲到；null = 老数据 / 手机）。
 * 片 d：顺带交出最后那行问题分类（D65）。`kinds === null` = 这一趟没写那一行（库里那一列就别碰）；
 * **分类不进 `stored`** —— 它存在 `interrupts.kinds`，答案全文里一个字都不留（历史页、D77 喂回给模型的都是 `stored`）。
 */
export function settleAnswer(
  raw: string,
  segments: readonly TranscriptSegment[],
  durationS: number | null,
): { body: string; refs: AnswerRef[]; stored: string; kinds: QuestionKind[] | null } {
  const { body, block, kinds } = splitRefsBlock(raw);
  const refs = block ? verifyRefs(parseRefsBlock(block), segments, durationS) : [];
  return { body, refs, stored: refs.length ? `${body}\n\n${refsText(refs)}` : body, kinds };
}

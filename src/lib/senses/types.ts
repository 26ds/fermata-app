// M3.11 悬浮词卡 —— 气泡里那点数据的形状（D24：**客户端也要用它**，一行服务端依赖都不许有）。
//
// 气泡分两半，成本完全不同，所以数据也分两半：
//   context —— 「在这一句里是什么意思」。**每条 atom 各自的**，M3.10 收词时就付过钱了 → 秒出。
//   senses  —— 「另外三个最常用的意思」。**和谁收的、在哪个视频收的无关** → 全站共享缓存，
//              某个词在某门母语里全世界只算一次。

/** 一个义项：词性 + 一句话意思。两者都用用户母语写（D42） */
export interface Sense {
  /** 词性。中文母语看到的是「连词」，英文母语看到的是 "conjunction" —— 也跟着母语走 */
  pos: string;
  gloss: string;
}

/** 气泡要显示的全部内容 */
export interface Lookup {
  /** 用户划下来的原文，一字不差 */
  term: string;
  /**
   * 在**它自己那句话**里的意思。没有 = 这个词还没被收进词库
   * （本片只让阴影词触发，所以正常情况下一定有；留空是为了别在 UI 上崩）。
   */
  context?: Sense;
  /** 另外几个最常用义项，最多 3 条 */
  senses: Sense[];
  /** 这一份是用哪门语言写的 —— 界面据此决定要不要重新取（改母语的那条路） */
  supportLang: string;
  /**
   * 义项那半边的结局（D44：**说不清楚的失败等于没做**）。
   *   ok       查到了
   *   none     查了，但这个词没有别的常用义项（词组多半属于这一类）—— 这不是失败
   *   failed   没查成，界面要给一颗**人点的**重试
   */
  sensesStatus: "ok" | "none" | "failed";
}

/** 最多留几条常用义项（创始人原话：其他涵盖的三种最常用的意思） */
export const MAX_SENSES = 3;

/** 词性和意思各自的长度闸 —— 模型偶尔会写成小作文，气泡装不下 */
export const POS_MAX = 24;
export const GLOSS_MAX = 60;

/** 把模型/数据库来的东西收成规规矩矩的义项数组。脏数据一律丢掉，绝不让它流进界面 */
export function readSenses(raw: unknown): Sense[] {
  if (!Array.isArray(raw)) return [];
  const out: Sense[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const pos = typeof r.pos === "string" ? r.pos.trim().slice(0, POS_MAX) : "";
    const gloss = typeof r.gloss === "string" ? r.gloss.trim().slice(0, GLOSS_MAX) : "";
    // 词性可以没有（有些词条本来就说不清），**但没有意思的义项等于没有** —— 丢
    if (!gloss) continue;
    out.push({ pos, gloss });
    if (out.length >= MAX_SENSES) break;
  }
  return out;
}

/**
 * 缓存的钥匙。**词要归一**：字幕里同一个词可能带着大小写差异出现
 * （句首的 "Because" 和句中的 "because" 是同一个词），不归一就会存两份、付两次钱。
 * 但**存进 atoms 的 term 一个字都不许动**（D45：他划的就是他要的）—— 归一只发生在这把钥匙上。
 */
export function senseKey(term: string): string {
  return term.trim().toLocaleLowerCase();
}

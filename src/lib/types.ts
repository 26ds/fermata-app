// Fermata 核心类型 — WORKORDER §3（数据模型）与 §4（核心抽象）
// 接口先行，实现可换。任何语言→任何语言的口子从数据层留死（content_lang + support_lang）。

/** 字幕段：一切媒介的通用语 */
export interface TranscriptSegment {
  /** 秒 */
  start: number;
  /** 秒 */
  end: number;
  text: string;
  speaker?: string;
}

export type SourceKind = "youtube" | "podcast" | "manual";
export type TranscriptStatus = "pending" | "partial" | "ready" | "failed";
export type AtomType = "vocab" | "concept" | "claim";
export type QuestionMode = "word" | "concept" | "voice" | "free";
/**
 * D65：问题三分类，**一个问题可以同时属于多类**（所以落库是 `text[]` 不是枚举）。
 * `language` 问的是这门语言本身、`knowledge` 问的是内容讲的那件事、
 * `misheard` 问的是"刚才发生了什么"（走神 / 没听清 / 要复述）。
 */
export type QuestionKind = "language" | "knowledge" | "misheard";
export type SessionMode = "post_session" | "weekly_interview";
export type FsrsState = "new" | "learning" | "review" | "relearning";

/** sources 表行 */
export interface SourceRow {
  id: string;
  user_id: string;
  kind: SourceKind;
  external_id: string | null;
  url: string | null;
  title: string | null;
  /**
   * 这条内容是什么语言。**可空 = 还不知道**（刚导入、字幕还没转）——
   * D42：不许拿数据库默认的 `'en'` 冒充"已知是英文"。转写时由模型实测回填。
   */
  content_lang: string | null;
  duration_s: number | null;
  /** 上次退出前播放到第几秒（迁移 0002） */
  last_position_s: number | null;
  transcript: TranscriptSegment[] | null;
  transcript_status: TranscriptStatus;
  created_at: string;
  // ── 迁移 0007（M3.6 历史与知识库）。写成可选：迁移没跑时这些列根本不存在，
  //    而查 `select *` 的地方拿到的行就是少这几个键 —— 类型上要允许。
  /** 最近一次**真正播放**的时刻。null = 还没看过，或这条是加字段之前的老数据 */
  last_watched_at?: string | null;
  /** 看过几次。同一天重复播放只算一次（拖进度条不该刷成"看过 40 次"） */
  watch_count?: number | null;
  /** 播客封面（导入时从 RSS/苹果接口存）。YouTube 不用，缩略图由 external_id 拼 */
  thumb_url?: string | null;
  /** M3.7 词库：整片扫出来的词组（`PhraseScan`，见 lib/phrases/types.ts）。用 unknown 是因为它是 jsonb */
  phrases?: unknown;
  /** `ready` / `partial` / `running@<ISO>`（并发锁）/ 空 = 还没扫过 */
  phrases_status?: string | null;
  // ── 迁移 0011（M3.15 问答工作台）。同样写成可选：迁移没跑时这一列不存在 ──
  /**
   * D66：看过的区间 `[[start,end],…]`（秒）。点点条上的灰段（＝跳过没看的）由它算。
   * 用 unknown 是因为它是 jsonb —— 读的地方自己校验，别信数据库里躺着的形状。
   */
  watched_ranges?: unknown;
}

/** interrupts 表行：打断点指针 (source, t) + 上下文窗口 [t−15, t+3] */
export interface InterruptRow {
  id: string;
  user_id: string;
  source_id: string;
  t_s: number;
  window_start_s: number;
  window_end_s: number;
  question: string | null;
  question_mode: QuestionMode | null;
  ai_answer: string | null;
  created_at: string;
  // ── 迁移 0011（M3.15 问答工作台，D62：每一轮问答就是一个捕获点）──
  //    全部写成可选：迁移没跑的时候这些列根本不存在，`select *` 拿回来的行就是少这几个键。
  /** 追问的母问题。答完之后**没有继续播视频**就又问的那一句，挂在它下面（计划 §B.4） */
  parent_id?: string | null;
  /** D65 问题三分类，可多属。答题那一次调用顺带标出来的 */
  kinds?: QuestionKind[] | null;
  /** D64：答案引用的其他时刻。jsonb，读的地方自己校验形状 */
  refs?: unknown;
  /** ③ Takeaway 的要点，切到那个 tab 才生成（D44）。jsonb */
  takeaway?: unknown;
  /** 勾进「知识点」清单了吗 */
  saved?: boolean | null;
}

/** atoms 表行：统一知识原子（FSRS Card 字段一比一落库） */
export interface KnowledgeAtomRow {
  id: string;
  user_id: string;
  source_id: string | null;
  interrupt_id: string | null;
  type: AtomType;
  term: string;
  gloss: string | null;
  context_quote: string | null;
  content_lang: string;
  support_lang: string;
  category: string | null;
  due: string;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  state: FsrsState;
  last_review: string | null;
  created_at: string;
}

/** sessions 表行：学习模式 / 周访谈会话记录 */
export interface StudySessionRow {
  id: string;
  user_id: string;
  mode: SessionMode;
  source_id: string | null;
  category: string | null;
  transcript: unknown;
  weak_atom_ids: string[] | null;
  started_at: string;
  ended_at: string | null;
}

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
  content_lang: string;
  duration_s: number | null;
  transcript: TranscriptSegment[] | null;
  transcript_status: TranscriptStatus;
  created_at: string;
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

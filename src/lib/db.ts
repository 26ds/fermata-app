import Dexie, { type EntityTable } from "dexie";
import type {
  SourceRow,
  InterruptRow,
  KnowledgeAtomRow,
  StudySessionRow,
} from "./types";

// Dexie 离线缓存壳（D12）：镜像 Supabase 四张表，M0 只建结构。
// 同步策略（Supabase ⇄ Dexie）在后续里程碑接入，此处仅提供本地读写能力。
const db = new Dexie("fermata") as Dexie & {
  sources: EntityTable<SourceRow, "id">;
  interrupts: EntityTable<InterruptRow, "id">;
  atoms: EntityTable<KnowledgeAtomRow, "id">;
  sessions: EntityTable<StudySessionRow, "id">;
};

db.version(1).stores({
  sources: "id, kind, created_at",
  interrupts: "id, source_id, created_at",
  atoms: "id, source_id, type, category, due, state",
  sessions: "id, mode, category, started_at",
});

export { db };

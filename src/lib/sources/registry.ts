import type { SourceKind } from "@/lib/types";
import type { SourceAdapter } from "./types";
import { youtubeAdapter } from "./youtube";

// 全项目唯一一处"这是什么平台"的判断。M1d 加播客 = 这里多一行。
export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  youtube: youtubeAdapter,
};

export function adapterFor(kind: SourceKind): SourceAdapter | null {
  return ADAPTERS[kind] ?? null;
}

/** 按注册顺序问一遍：谁认得这条输入？ */
export function detectAdapter(input: string): {
  adapter: SourceAdapter;
  parsed: { externalId: string; url: string };
} | null {
  for (const adapter of Object.values(ADAPTERS)) {
    const parsed = adapter.parse(input);
    if (parsed) return { adapter, parsed };
  }
  return null;
}

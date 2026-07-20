import type { SourceKind } from "@/lib/types";
import type { SourceAdapter } from "./types";
import { youtubeAdapter } from "./youtube";
import { podcastAdapter } from "./podcast";

// **服务端**那一半的注册表：全项目唯一一处"这条链接是什么平台"的判断。
// 客户端要的"用哪个播放器壳"在 players.ts —— 分家的理由写在那个文件顶上。
//
// 询问顺序有意义：YouTube 先问。播客那一档为了能收下五花八门的订阅源地址，
// parse 会把任何 http(s) 链接都先收下（见 podcast.ts），放前面会把 YT 链接抢走。
export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  youtube: youtubeAdapter,
  podcast: podcastAdapter,
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

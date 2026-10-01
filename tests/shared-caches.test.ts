import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sameTranscript } from "@/lib/transcript/shared";
import type { TranscriptSegment } from "@/lib/types";

// 2026-09-26：共享缓存（字幕 / 译文 / 词义）只有服务器能写（迁移 0014）；
// 粘贴的字幕不进共享缓存，由它翻出来的译文也不进（D31 补记 · 创始人选 B）。

const seg = (start: number, text: string): TranscriptSegment => ({ start, end: start + 2, text });
const shared = [seg(0, "Hello there."), seg(2.5, "General Kenobi.")];

describe("sameTranscript: only translations of the shared transcript go into the shared cache", () => {
  test("the machine transcript every viewer gets matches", () => {
    expect(sameTranscript([seg(0, "Hello there."), seg(2.5, "General Kenobi.")], shared)).toBe(true);
  });

  test("tiny float noise in start times still matches", () => {
    expect(sameTranscript([seg(0.004, "Hello there."), seg(2.503, "General Kenobi.")], shared)).toBe(true);
  });

  test("a pasted transcript with the same timing but different words does not", () => {
    expect(sameTranscript([seg(0, "Hello there."), seg(2.5, "Something else entirely.")], shared)).toBe(false);
  });

  test("different timing, different length or nothing at all does not", () => {
    expect(sameTranscript([seg(0, "Hello there."), seg(3, "General Kenobi.")], shared)).toBe(false);
    expect(sameTranscript([seg(0, "Hello there.")], shared)).toBe(false);
    expect(sameTranscript([], [])).toBe(false);
  });
});

describe("sharedCacheWriter: who writes the shared caches", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const sessionClient = { tag: "the signed-in user's own client" } as unknown as SupabaseClient;

  async function load() {
    vi.resetModules();
    return (await import("@/lib/supabase/cache-writer")).sharedCacheWriter;
  }

  test("without SUPABASE_SERVICE_ROLE it falls back to the caller's session client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sharedCacheWriter = await load();
    expect(sharedCacheWriter(sessionClient)).toBe(sessionClient);
  });

  test("with SUPABASE_SERVICE_ROLE it uses one server client, never the user's", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE", "test-service-role-key");
    const sharedCacheWriter = await load();
    const first = sharedCacheWriter(sessionClient);
    expect(first).not.toBe(sessionClient);
    expect(typeof first.from).toBe("function");
    expect(sharedCacheWriter(sessionClient)).toBe(first);
  });
});

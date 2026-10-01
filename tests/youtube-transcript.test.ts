import { describe, expect, test } from "vitest";
import {
  linesToSegments,
  parseTimestampedLines,
  planChunks,
  resolveOffset,
} from "@/lib/transcript/gemini-youtube";

// Gemini 看 YouTube 视频逐句转写（D27）：切片、读时间戳、认时间基准。

describe("planChunks", () => {
  test("first slice is 2 minutes, the rest are 10 minutes", () => {
    expect(planChunks(1500)).toEqual([
      { startS: 0, endS: 120 },
      { startS: 120, endS: 720 },
      { startS: 720, endS: 1320 },
      { startS: 1320, endS: 1500 },
    ]);
  });

  test("short and empty videos", () => {
    expect(planChunks(90)).toEqual([{ startS: 0, endS: 90 }]);
    expect(planChunks(0)).toEqual([]);
  });
});

describe("parseTimestampedLines", () => {
  test("reads [mm:ss] and [h:mm:ss], strips list markers, skips junk", () => {
    const raw = ["[00:00] I'd like to see her", "noise without a time", "[10:05] - Second line", "[1:02:03] Third"].join("\n");
    expect(parseTimestampedLines(raw)).toEqual([
      { at: 0, text: "I'd like to see her" },
      { at: 605, text: "Second line" },
      { at: 3723, text: "Third" },
    ]);
  });
});

describe("resolveOffset", () => {
  // 实测：同一片 600–1200 秒、同一个 prompt，一次回相对时间，一次回绝对时间
  const relative = [
    { at: 0, text: "a" },
    { at: 300, text: "b" },
    { at: 590, text: "c" },
  ];
  const absolute = relative.map((l) => ({ ...l, at: l.at + 600 }));

  test("first slice: both time bases are the same thing", () => {
    expect(resolveOffset(relative, 0, 120)).toBe(0);
  });

  test("later slice with timestamps counted from the slice start gets shifted", () => {
    expect(resolveOffset(relative, 600, 1200)).toBe(600);
  });

  test("later slice with absolute timestamps is used as is", () => {
    expect(resolveOffset(absolute, 600, 1200)).toBe(0);
  });
});

describe("linesToSegments", () => {
  test("applies the offset, ends each line at the next one, drops lines outside the slice", () => {
    const lines = [
      { at: 0, text: "first" },
      { at: 4, text: "second" },
      { at: 700, text: "outside the slice" },
    ];
    expect(linesToSegments(lines, 600, 1200)).toEqual([
      { start: 600, end: 604, text: "first" },
      { start: 604, end: 1200, text: "second" },
    ]);
  });
});

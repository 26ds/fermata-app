import { describe, expect, test } from "vitest";
import { parseClock, settleAnswer, verifyRefs } from "@/lib/ask/refs";
import type { TranscriptSegment } from "@/lib/types";

// D64：模型说「视频别处还讲到」必须给原句；服务端去字幕里找，找到才可点，时间吸附到那一行的真实起点。

const seg = (start: number, text: string): TranscriptSegment => ({ start, end: start + 4, text });

const captions: TranscriptSegment[] = [
  seg(12, "Welcome back to the show."),
  seg(30, "Dagger, Comanche, we're picking up two bandits."),
  seg(75, "And um instead of just showing you the answer, uh I will ask the model."),
  seg(142, "Dagger, Comanche, we're picking up two bandits."),
];

describe("parseClock", () => {
  test("reads mm:ss, h:mm:ss, minutes past an hour and plain seconds", () => {
    expect(parseClock("05:12")).toBe(312);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("80:00")).toBe(4800);
    expect(parseClock("312")).toBe(312);
  });

  test("rejects what it can't read", () => {
    expect(parseClock("5:75")).toBeNull();
    expect(parseClock("soon")).toBeNull();
  });
});

describe("verifyRefs", () => {
  test("a quote found in the captions snaps to that line's real start, whatever time the model claimed", () => {
    const [ref] = verifyRefs([{ t: "00:40", quote: "welcome back to the show", note: "intro" }], captions, 600);
    expect(ref).toMatchObject({ ok: true, t_s: 12, claimed_s: 40, line: "Welcome back to the show." });
  });

  test("when the same line appears twice, the claimed time picks the nearest one", () => {
    const [ref] = verifyRefs(
      [{ t: "02:20", quote: "Dagger, Comanche, we're picking up two bandits", note: "" }],
      captions,
      600,
    );
    expect(ref.ok).toBe(true);
    expect(ref.t_s).toBe(142);
  });

  test("filler words the model dropped while copying still match", () => {
    const [ref] = verifyRefs(
      [{ t: "01:15", quote: "instead of just showing you the answer, I will ask the model", note: "" }],
      captions,
      600,
    );
    expect(ref.ok).toBe(true);
    expect(ref.t_s).toBe(75);
  });

  test("a quote that isn't in the captions is kept but not clickable", () => {
    const [ref] = verifyRefs([{ t: "03:00", quote: "a line nobody ever said on this show", note: "made up" }], captions, 600);
    expect(ref).toMatchObject({ ok: false, t_s: null, line: null, note: "made up" });
  });

  test("a time without a quote doesn't count as evidence", () => {
    const [ref] = verifyRefs([{ t: "00:30", quote: "", note: "trust me" }], captions, 600);
    expect(ref.ok).toBe(false);
    expect(ref.t_s).toBeNull();
  });
});

describe("settleAnswer", () => {
  test("splits the answer body from the refs block and verifies each ref", () => {
    const raw = [
      "They are about to be attacked.",
      "",
      "[[REFS]]",
      '{"t": "00:30", "quote": "we\'re picking up two bandits", "note": "first warning"}',
    ].join("\n");
    const { body, refs } = settleAnswer(raw, captions, 600);
    expect(body).toBe("They are about to be attacked.");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ ok: true, t_s: 30 });
  });
});

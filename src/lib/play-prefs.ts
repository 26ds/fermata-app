// 播放偏好 —— 倍速 + 「一跳几秒」。纯数据 + 纯函数，客户端也能 import（和 lib/lang.ts 一个路数）。
//
// 存哪儿：`user_settings.settings` 里的两个键（`playRate` / `skipStep`），**零新迁移**。
// 为什么不放 localStorage：这是"我习惯 1.5 倍速听"这种跟人走的习惯，换台设备还得重设一遍很烦。
// （字幕字号仍在 localStorage —— 那个跟屏幕尺寸走，跟着人跑反而不对。）

/** 倍速档位。0.5 是给学语言的人留的：一句话听不清就慢下来，比反复回退管用 */
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** 一跳几秒。创始人 2026-08-01 点名要的这几档，默认 10 */
export const SKIP_STEPS = [5, 10, 15, 20, 30] as const;

export const DEFAULT_RATE = 1;
export const DEFAULT_SKIP = 10;

export interface PlayPrefs {
  rate: number;
  skipStep: number;
}

export const DEFAULT_PLAY_PREFS: PlayPrefs = { rate: DEFAULT_RATE, skipStep: DEFAULT_SKIP };

/** 倍速写成人看的样子：1×、1.25×、0.75× */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/**
 * 从整坨设置里挑出这两个值。**只认档位表里的数** —— 库里存着个 3.7 倍速
 * （手改的 / 老版本写坏的）不该被端上来，直接回默认，别让界面显示一个按不出来的数。
 */
export function readPlayPrefs(settings: Record<string, unknown> | null | undefined): PlayPrefs {
  const s = settings ?? {};
  const rate = Number(s.playRate);
  const step = Number(s.skipStep);
  return {
    rate: (RATES as readonly number[]).includes(rate) ? rate : DEFAULT_RATE,
    skipStep: (SKIP_STEPS as readonly number[]).includes(step) ? step : DEFAULT_SKIP,
  };
}

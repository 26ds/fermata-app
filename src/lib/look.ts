// M3.16 看画面回答（D75）—— 「看画面再答」给模型看的是哪一段。
//
// **服务端（喂给 Gemini）和界面（角标上写「看了画面 · 02:45–02:57」）共用这一份**：
// 两边各算一遍，迟早一边改了另一边没改，角标就开始说谎。
// D24：纯函数，客户端要 import，一行服务端依赖都不许有。

/** 提问那一秒往前看几秒 —— 他多半是「刚才那一下是什么」 */
export const LOOK_BEFORE_S = 10;
/** 往后看几秒 —— 按暂停总比看到的晚一点点 */
export const LOOK_AFTER_S = 2;

/**
 * 这一轮看的是 `[fromS, toS]`（整秒）。`tS` 是这一轮落库的那一秒（问答栏 `@` 上显示的那个数）。
 * 时长知道就把终点夹在片尾以内；不知道（0 / null）就不夹 —— 模型那头越过片尾只是少几帧，不会出错。
 */
export function lookClip(tS: number, durationS?: number | null): { fromS: number; toS: number } {
  const t = Math.max(0, Math.floor(tS));
  const end = t + LOOK_AFTER_S;
  return {
    fromS: Math.max(0, t - LOOK_BEFORE_S),
    toS: durationS && durationS > 0 ? Math.min(Math.floor(durationS), end) : end,
  };
}

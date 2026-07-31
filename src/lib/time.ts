/** 秒 → mm:ss。播放时钟、点点条、打断面板共用一份，别各写各的。 */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * 秒 → h:mm:ss（不到一小时就退回 mm:ss）。**时长**用这个，不能用 mmss ——
 * 一支 1 小时 20 分的视频，mmss 会写成「80:00」。
 * 播放时钟仍走 mmss（那是位置，位数固定才不会左右跳）。
 */
export function hms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  if (h <= 0) return mmss(s);
  return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

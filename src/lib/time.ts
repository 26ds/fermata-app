/** 秒 → mm:ss。播放时钟、点点条、打断面板共用一份，别各写各的。 */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

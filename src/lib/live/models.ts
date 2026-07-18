// Live 模型的默认值与环境变量覆盖（服务端两个 route 共用）
export const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export function envLiveModel(): string {
  return process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL;
}

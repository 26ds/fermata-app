// M0.5 Live 通路 — 音频采集/播放工具层
// 参照 google-gemini/live-api-web-console（Apache-2.0）的 AudioWorklet 思路移植：
//   采集：麦克风 → AudioWorklet 攒块 → Float32 → Int16 PCM(16kHz) → base64 → WS 上行
//   播放：WS 下行 base64 → Int16 PCM(24kHz) → Float32 → AudioBuffer 排队播放

/** Gemini Live 上行采样率（官方要求 16kHz 单声道 PCM16） */
export const INPUT_SAMPLE_RATE = 16000;
/** Gemini Live 下行采样率（官方输出 24kHz PCM16） */
export const OUTPUT_SAMPLE_RATE = 24000;

// ─────────────────────────── 采集侧 worklet ───────────────────────────
// 攒满 2048 个采样点（16kHz 下约 128ms）再发一次，避免每 128 点就过一次消息通道。
// 用 Blob URL 内联注册，省去往 public/ 放静态文件（Turbopack/webpack 都不用管它）。
const recorderWorkletCode = `
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buffer[this.offset++] = ch[i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0));
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-recorder", PcmRecorder);
`;

export function recorderWorkletUrl(): string {
  return URL.createObjectURL(
    new Blob([recorderWorkletCode], { type: "application/javascript" }),
  );
}

// ─────────────────────────── 格式转换 ───────────────────────────

/** Float32 [-1,1] → Int16 PCM → base64（上行给 Gemini 的格式） */
export function floatToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 Int16 PCM（Gemini 下行）→ Float32 [-1,1] */
export function pcm16Base64ToFloat(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/**
 * 线性重采样到 16kHz。
 * 桌面 Chrome 允许 new AudioContext({sampleRate:16000}) 直接拿到 16k；
 * 但 iOS Safari 可能忽略请求返回 44.1/48kHz，这里兜底把任意采样率压回 16k。
 */
export function downsampleTo16k(
  input: Float32Array,
  inputRate: number,
): Float32Array {
  if (inputRate === INPUT_SAMPLE_RATE) return input;
  const ratio = inputRate / INPUT_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    out[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return out;
}

// ─────────────────────────── 播放队列 ───────────────────────────

/**
 * 顺序播放队列：收到的每块 PCM 依次无缝衔接；interrupt() 立刻静音并清空
 * （对应 Live API 的 serverContent.interrupted —— 用户插话时模型停嘴）。
 */
export class PcmPlaybackQueue {
  private ctx: AudioContext;
  private cursor = 0; // 下一块的起播时间
  private active = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
  }

  async resume() {
    // iOS 要求在用户手势里 resume 后才出声
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** 还有声音在排队/播放吗（本地抢闭嘴的触发条件之一） */
  get playing(): boolean {
    return this.active.size > 0;
  }

  /** 会话结束：静音并挂起。不销毁 —— Context 跨会话复用，iOS 反复重建音频通路会抽风 */
  async suspend() {
    this.interrupt();
    if (this.ctx.state === "running") await this.ctx.suspend();
  }

  enqueue(samples: Float32Array) {
    const buffer = this.ctx.createBuffer(
      1,
      samples.length,
      OUTPUT_SAMPLE_RATE,
    );
    buffer.getChannelData(0).set(samples);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.cursor, this.ctx.currentTime);
    source.start(startAt);
    this.cursor = startAt + buffer.duration;
    this.active.add(source);
    source.onended = () => this.active.delete(source);
  }

  /** 用户插话：停掉所有排队中的声音 */
  interrupt() {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // 已自然结束的 source 会抛错，忽略
      }
    }
    this.active.clear();
    this.cursor = 0;
  }

  async close() {
    this.interrupt();
    await this.ctx.close();
  }
}

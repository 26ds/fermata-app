// 内容源抽象 — WORKORDER §4。
// 核心信条：除了 registry.ts，全项目没有第二处代码知道"这是 YouTube 还是播客"。
// 上层（watch-stage / 悬浮球 / 点点条）只认 SourceRow + PlayerHandle。
// 新增一个平台 = 新增一个 adapter 文件 + registry 注册一行，别处零改动。

import type { ComponentType } from "react";
import type { SourceKind, SourceRow } from "@/lib/types";

/** 播放器句柄：上层控制播放的唯一接口，时间单位一律秒 */
export interface PlayerHandle {
  /** 当前播放位置（秒）。未就绪返回 0 */
  getCurrentTime(): number;
  /** 总时长（秒）。未就绪返回 0 */
  getDuration(): number;
  seekTo(seconds: number): void;
  play(): void;
  pause(): void;
}

export interface PlayerProps {
  source: SourceRow;
  /** 播放器可用时回调，把句柄交给上层 */
  onReady(handle: PlayerHandle): void;
  /** 播放/暂停状态变化。M1c 的打断面板靠它在暂停时弹出 */
  onPlayingChange(playing: boolean): void;
}

/** 一条链接解析出来的最小标识 */
export interface ParsedSource {
  externalId: string;
  url: string;
}

/** 元数据：标题与时长。拿不到就是 null，不猜 */
export interface ResolvedMeta {
  title: string | null;
  durationS: number | null;
}

export interface SourceAdapter {
  kind: SourceKind;
  /** 认不认这条输入。纯函数，不发网络请求 —— 客户端也能跑 */
  parse(input: string): ParsedSource | null;
  /** 取标题等元数据。只在服务端调用（可能带 key 的活都在这一层） */
  resolve(parsed: ParsedSource): Promise<ResolvedMeta>;
  /** 播放器组件。必须是 "use client" 模块里的组件 */
  Player: ComponentType<PlayerProps>;
}

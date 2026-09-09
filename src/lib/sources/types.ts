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
  /**
   * 倍速。**可能被平台拒**（YouTube 只认它自己给的那几档，且换片后会回 1），
   * 所以设完不许假定成功 —— 界面上显示的那个数一律以 `getRate()` 的实测为准。
   */
  setRate(rate: number): void;
  /** 当前真实倍速。未就绪返回 1 */
  getRate(): number;
}

export interface PlayerProps {
  source: SourceRow;
  /** 播放器可用时回调，把句柄交给上层 */
  onReady(handle: PlayerHandle): void;
  /** 是否正在播放。只用来显示状态灯，别拿它当"用户暂停了"的信号 —— 见下 */
  onPlayingChange(playing: boolean): void;
  /**
   * 用户**真的**按了暂停时才触发。缓冲、播放结束一律不触发。
   *
   * 为什么不能用 `onPlayingChange(false)` 代替：那个信号是有损的 ——
   * YouTube 的 BUFFERING / ENDED / CUED 都会让 playing 变 false，网络卡一下
   * 打断面板就自己弹出来了。各 adapter 自己有能力区分（YT 有 PlayerState.PAUSED，
   * `<audio>` 有原生 pause 事件），所以把这个区分放进契约，而不是让上层猜。
   */
  onPause?(): void;
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
  /**
   * M1d 新增：resolve 期间才能确定的**更精确的指针**，缺省沿用 parse 的结果。
   *
   * 为什么需要：播客贴进来的是**订阅源**，而能播的是源里**某一集**。
   * 「哪一集」只有把 RSS 拉下来才知道，parse（纯函数、不发网络）做不到。
   * YouTube 不用这一档 —— videoId 在链接里就写着。
   */
  externalId?: string;
  url?: string;
  /**
   * M3.6：封面图地址。历史与知识库那一列左边的方图要用（迁移 0007 的 `sources.thumb_url`）。
   * YouTube **不填**——它的缩略图能由 videoId 直接拼出来，存一份只会过期。
   * 播客没有这种公共约定，只能导入时从 RSS / 苹果接口顺手抓一张。抓不到就是 null，不猜。
   */
  thumbUrl?: string | null;
}

/**
 * resolve 失败且**原因该讲给用户听**时抛这个（→ 400 + 中文原文）。
 * 其余异常一律当成"网络抽风"，走 502。
 */
/**
 * 说得清原因的导入失败（不是 feed、里面没音频…）。
 *
 * M3.9 片 c：**多带一个文案 key**。这一层是纯服务端库，拿不到"这个人用什么语言
 * 看界面"；API 路由那边拿得到，所以由它翻（`tMaybeKey`）。
 * `message` 仍然写着中文原话 —— 那是日志和兜底用的，`copyKey` 才是给人看的那条。
 */
export class SourceResolveError extends Error {
  readonly copyKey?: string;
  readonly copyArgs: readonly unknown[];

  constructor(message: string, copyKey?: string, ...copyArgs: unknown[]) {
    super(message);
    this.copyKey = copyKey;
    this.copyArgs = copyArgs;
  }
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

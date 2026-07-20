import type { ComponentType } from "react";
import type { SourceKind } from "@/lib/types";
import type { PlayerProps } from "./types";
import { YouTubePlayer } from "./youtube-player";
import { PodcastPlayer } from "./podcast-player";

// M1d — **客户端**那一半的注册表：kind → 播放器壳。
//
// 为什么要跟 registry.ts 分家（原计划是一个文件）：
// 播客的 resolve 要在服务端解析 RSS（依赖 rss-parser → 依赖 node 的 http/xml 模块）。
// 而 watch-stage 是客户端组件，它一 import registry 就会把整条服务端依赖链
// 拽进浏览器包 —— 轻则 PWA 首屏胖几百 KB，重则客户端构建直接失败。
//
// 分家的分界线是有道理的、也该长期守住：
//   **客户端只需要"拿什么壳去播"，"这条链接是什么、叫什么"永远是服务端的活。**
// 代价：新增一个平台从"注册一行"变成"注册两行"（这里一行、registry.ts 一行）。

const PLAYERS: Partial<Record<SourceKind, { Player: ComponentType<PlayerProps> }>> = {
  youtube: { Player: YouTubePlayer },
  podcast: { Player: PodcastPlayer },
};

/** 包一层对象而不是直接返回组件：调用方拿到的是"查表查到的东西"，
    不是"渲染期现造的组件"—— 后者会让组件每次渲染换身份、状态被清空。 */
export function playerFor(kind: SourceKind): { Player: ComponentType<PlayerProps> } | null {
  return PLAYERS[kind] ?? null;
}

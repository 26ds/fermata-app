// 聊天文字的两件小事：**剥 markdown** 和 **切成短句**。
//
// 这里是它们**唯一的**住处。原来只长在 `immersive-chat.tsx` 里，
// M3.15 片 b 的问答栏要用同一套 —— 计划的「文件地图」写死了
// 「抽成共享模块给新问答栏用，**不许复制粘贴两份**」。
// 理由不是洁癖：两份复制品会各自漂移，而"同一个 AI 答案在沉浸聊天里没有星号、
// 在右栏问答里冒出一堆星号"这种 bug，查起来比写它贵十倍。
//
// ⚠️ 这个文件**没有 "use client"**，也不该有：它是两个纯函数，服务端要用也用得了。
// 沉浸聊天与问答栏都是客户端组件，import 一个纯模块不会把它拽成 client-only。

/**
 * 剥掉 markdown 记号，像人聊天一样纯文字。
 *
 * 引擎那边已经被提示词禁了 markdown，这是**兜底**；更要紧的是流式：
 * 半截收到 `**` 时不会先闪出两个星号再变粗（我们根本不渲染粗体）。
 * 所以是全局去掉 `*`、反引号、行首的 `#`/项目符号/序号。
 */
export function cleanMarkdown(text: string): string {
  return text
    .replace(/`+/g, "")
    .replace(/\*+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "");
}

/** 把一轮文字切成 1–4 行的小段（先剥 markdown，再按换行 + 句末标点），歌词式留白 */
export function toSegments(text: string): string[] {
  return cleanMarkdown(text)
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?…])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

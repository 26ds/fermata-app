import type { CopyKey } from "@/lib/copy";

// 返回箭头去哪 —— 全站唯一一份规则（M3.6-fix，创始人 2026-07-31）。
//
// 起因：从「历史与知识库 → 某条内容 → 某个暂停点」跳进观看页之后，
// 返回箭头把人扔回「观看」列表 —— 刚才那条线索就断了。
// 创始人要的是**一层层往回退**：观看页 ← 那条内容的「暂停点与聊天」 ← 历史与知识库。
//
// 为什么用一个 `?from=` 枚举，而不是 `router.back()`：
//   `router.back()` 靠浏览器历史，刷新一下、或者直接把链接发给自己打开，
//   退回去的可能是上一个网站。`?from=` 写在地址里，刷新、分享、加书签都还对。
// 为什么**不接受任意 URL**：那是开放重定向的口子。这里只认下面这几个固定值，
//   别的一律当没传，回默认那一层。

/**
 * 认识的来路。加新值时同步改 backTarget，别在别处另写一套判断。
 * `player` / `libraryitem` 指向**某一条内容**，所以还要带一个 `sid`（见 settingsBackTarget）。
 */
export type BackFrom =
  | "library"
  | "favorites"
  | "vocab"
  | "watch"
  | "live"
  | "player"
  | "libraryitem";

/** 只认长得像 UUID 的东西。**绝不把外面传进来的字符串直接拼进路径** —— 那是开放重定向的口子 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BackTarget {
  href: string;
  /**
   * 给读屏软件用的说明。图标只有一个 ←，去哪得靠它说清楚。
   *
   * **存的是文案 key，不是那句话本身**（M3.9 片 c）：这个文件是纯函数，
   * 拿不到"这个人用什么语言看界面"；返回 key、让调用处 `t(...)`，
   * 既不用给每个函数塞一个语言参数，也顺带把这八条收进了类型闸门 ——
   * 漏写英文那份就编译不过。
   */
  labelKey: CopyKey;
}

/** 观看页 `/watch/[id]` 的返回箭头该去哪 */
export function watchBackTarget(from: string | undefined, sourceId: string): BackTarget {
  // 从历史与知识库里点暂停点 / 点聊天进来的 → 退回那条内容的回看页，而不是内容列表
  if (from === "library") {
    return { href: `/library/${sourceId}`, labelKey: "back.libraryItem" };
  }
  // 从「观看 → ★ 收藏」那一栏点进来的 → 退回收藏，别把筛选状态吃掉
  if (from === "favorites") {
    return { href: "/watch?tab=favorites", labelKey: "back.favorites" };
  }
  // M3.7：从「全部词库」点一条词跳过来的 → 退回词库，接着背下一条
  if (from === "vocab") {
    return { href: "/library/vocab", labelKey: "back.vocab" };
  }
  return { href: "/watch", labelKey: "back.watchList" };
}

/**
 * 设置页 `/settings` 的返回箭头该去哪（M3.9 片 a）。
 *
 * 设置页有三个入口，退回去必须是**进来的那个**：
 *   `/library` 的「设置」那一行、`/watch` 顶上那条母语横幅、`/library/vocab` 的指路条。
 * 不认的值一律退回 `/library`（设置那一行就挂在那儿，退到它旁边最不迷路）。
 */
export function settingsBackTarget(from: string | undefined, sid?: string): BackTarget {
  // 从某一条内容里进来的 —— 退回**那一条**，不是退回列表。
  // 改个设置就被扔回列表、还得重新找回刚才那支视频，是最招人烦的一种"返回"
  if (from === "player" && sid && UUID.test(sid)) {
    return { href: `/watch/${sid}`, labelKey: "back.lastContent" };
  }
  if (from === "libraryitem" && sid && UUID.test(sid)) {
    return { href: `/library/${sid}`, labelKey: "back.libraryItem" };
  }
  if (from === "watch") return { href: "/watch", labelKey: "back.watch" };
  if (from === "live") return { href: "/lab/live", labelKey: "back.live" };
  if (from === "vocab") return { href: "/library/vocab", labelKey: "back.vocab" };
  return { href: "/library", labelKey: "back.library" };
}

/** 给链接挂上来路。`from` 为空就原样返回，别在地址里留一个空参数 */
export function withFrom(href: string, from?: BackFrom | null): string {
  if (!from) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${from}`;
}

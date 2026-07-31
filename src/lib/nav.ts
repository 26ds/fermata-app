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

/** 认识的来路。加新值时同步改 backTarget，别在别处另写一套判断 */
export type BackFrom = "library" | "favorites" | "vocab";

export interface BackTarget {
  href: string;
  /** 给读屏软件用的说明。图标只有一个 ←，去哪得靠它说清楚 */
  label: string;
}

/** 观看页 `/watch/[id]` 的返回箭头该去哪 */
export function watchBackTarget(from: string | undefined, sourceId: string): BackTarget {
  // 从历史与知识库里点暂停点 / 点聊天进来的 → 退回那条内容的回看页，而不是内容列表
  if (from === "library") {
    return { href: `/library/${sourceId}`, label: "返回这条内容的暂停点与聊天" };
  }
  // 从「观看 → ★ 收藏」那一栏点进来的 → 退回收藏，别把筛选状态吃掉
  if (from === "favorites") {
    return { href: "/watch?tab=favorites", label: "返回收藏列表" };
  }
  // M3.7：从「全部词库」点一条词跳过来的 → 退回词库，接着背下一条
  if (from === "vocab") {
    return { href: "/library/vocab", label: "返回全部词库" };
  }
  return { href: "/watch", label: "返回观看列表" };
}

/** 给链接挂上来路。`from` 为空就原样返回，别在地址里留一个空参数 */
export function withFrom(href: string, from?: BackFrom | null): string {
  if (!from) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${from}`;
}

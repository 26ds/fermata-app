// 「回到原网页」的地址 —— 标题旁那个 ↗ 用。
//
// 我们只存指针（D3），没有专门的「原页面」字段，但那条**人能看的**网页地址
// 其实一直都在，只是按 kind 藏在不同指针里：
//   - youtube：`url` 本身就是观看页（youtube.com/watch?v=…）
//   - podcast 网页导入（小宇宙，D25）：`external_id` 存的就是单集页地址（已去跟踪参数）
//   - podcast RSS/Apple（D23）：`external_id = <feedUrl>#<guid>`，guid 常常就是单集网页，
//     退一步用 feedUrl
// 取不到 http(s) 页面就返回 null（manual、或只有音频直链的情况）→ 调用方不显示 ↗。
//
// 纯函数、只读 source 的三个指针字段，**客户端可安全 import**（不碰任何服务端依赖，D24）。

function isHttp(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//i.test(s);
}

// 结构化入参：SourceRow（kind 是联合类型）和列表项 SourceListItem（kind 是 string）都能传。
export function sourceOriginUrl(source: {
  kind: string;
  url: string | null;
  external_id: string | null;
}): string | null {
  if (source.kind === "youtube") return isHttp(source.url) ? source.url : null;

  if (source.kind === "podcast") {
    const eid = source.external_id ?? "";
    const hash = eid.lastIndexOf("#");
    if (hash >= 0) {
      const guid = eid.slice(hash + 1);
      if (isHttp(guid)) return guid; // guid 就是单集网页
      const feed = eid.slice(0, hash);
      return isHttp(feed) ? feed : null; // 退回 feed 地址
    }
    if (isHttp(eid)) return eid; // 网页导入：external_id 即单集页
    return null; // 只有音频直链等 → 不给 ↗
  }

  return isHttp(source.url) ? source.url : null;
}

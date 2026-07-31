// 缩略图地址 —— 历史与知识库每一行左边那块方图（M3.6）。
//
// YouTube **不存图也不调 API**：i.ytimg.com 上有一套按 videoId 拼出来的固定地址，
// 白拿、零存储、零额度。mqdefault（320×180）是列表这个尺寸下最划算的一档。
// 播客没有这种公共约定，只能在导入时从 RSS / 苹果接口把封面存进 sources.thumb_url。
// 两者都没有 → 返回 null，调用方画一个占位方块（**绝不留空白格子**，见 M3.6-plan B）。
//
// 纯函数、只读 source 上的三个字段，客户端可安全 import（D24：客户端零服务端依赖）。

export function thumbUrlFor(source: {
  kind: string;
  external_id: string | null;
  /** 迁移 0007 才有这一列；没跑迁移时上层传 undefined，照样能给 YouTube 拼出图 */
  thumb_url?: string | null;
}): string | null {
  // 存下来的封面优先：播客靠它，而且万一将来给某支 YouTube 存了自定义图，也该以存的为准
  if (source.thumb_url) return source.thumb_url;
  if (source.kind === "youtube" && source.external_id) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(source.external_id)}/mqdefault.jpg`;
  }
  return null;
}

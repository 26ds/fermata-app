// M3.7 —— 客户端写设置的唯一出口（`PUT /api/settings`，浅合并，改一个键不冲掉别的）。
//
// 之前每个组件各写一段 fetch，键名靠手打；语言偏好一来有四个键、三处要写，
// 再散着写迟早写错一个键名，而且**写错了不会报错，只会静静地不生效**。

/** 写一小块设置。**失败不抛** —— 记不住偏好不该拦着用户看视频，下次再试就是 */
export async function putSettings(patch: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: patch }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

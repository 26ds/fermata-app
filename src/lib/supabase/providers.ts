import { supabaseUrl, supabaseAnonKey } from "./config";

/**
 * 登录页要知道「哪几种登录方式现在**真的**开着」。
 *
 * GoTrue 自己有一个公开端点报这件事：`GET /auth/v1/settings`（带 apikey 头，就是那把
 * 本来就公开的 anon key，D13 允许），回 `{ external: { google: bool, … }, disable_signup: bool }`。
 *
 * **为什么不做成环境变量**：环境变量改完必须重新部署一次才生效（D32 踩过这个坑），
 * 而这个端点是「后台一开，下次打开登录页就看得见」—— 中间不用改代码、不用重发版。
 *
 * **取不到就当没开（fail closed）**：宁可少一颗按钮，也不要摆一颗点下去报错的按钮 ——
 * 邮箱那条路永远在，少一颗按钮不会把人挡在门外。
 */
export async function enabledProviders(): Promise<{ google: boolean }> {
  if (!supabaseUrl || !supabaseAnonKey) return { google: false };
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
      cache: "no-store", // 后台开关一拨就要生效，不许缓存
    });
    if (!res.ok) return { google: false };
    const json = (await res.json()) as { external?: Record<string, boolean> };
    return { google: json.external?.google === true };
  } catch {
    return { google: false };
  }
}

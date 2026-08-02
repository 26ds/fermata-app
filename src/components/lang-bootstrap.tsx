"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { normalizeLang, type LangPrefs } from "@/lib/lang";
import { putSettings } from "@/lib/settings-client";

// M3.7 —— 母语怎么来（D42：**不做设置墙**）。
//
// 新用户进来不该先撞上一张"请选择你的母语"的表单。浏览器早就知道答案了 ——
// `navigator.language` 是他自己设的，比让他再选一遍准，也比我们猜"中文"诚实。
//
// 只在**母语真的空着**时写一次；有值就什么都不做（不是每次加载都往后台写）。
// 写完 router.refresh() 让这一页立刻拿到新值 —— 否则"第一次导入非母语内容"
// 那一句问询要等到下次进页面才问得出来。这辈子每个账号只跑一次。
export function LangBootstrap({ prefs }: { prefs: LangPrefs }) {
  const router = useRouter();
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current || prefs.nativeLang) return;
    doneRef.current = true;

    const guess = normalizeLang(typeof navigator === "undefined" ? "" : navigator.language);
    if (!guess) return; // 探不到就算了，别塞一个 "en" 进去（D42 红线）

    // ⚠️ **故意不写 `nativeLangConfirmed`**（M3.9 / D42 修订①）。
    // 这里写下的是一个**猜测** —— 键留空就是"还没跟他确认过"，
    // `<LangGuessBanner />` 靠这一点决定要不要说那句「这是自动填的」。
    // 别顺手补一个 `nativeLangConfirmed: true` 让它闭嘴，那就退回到静默了。
    void putSettings({ nativeLang: guess }).then((ok) => {
      if (ok) router.refresh();
    });
  }, [prefs.nativeLang, router]);

  return null;
}

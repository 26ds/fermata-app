"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LangPrefs } from "@/lib/lang";
import { putSettings } from "@/lib/settings-client";
import { TARGET_LANGS } from "@/lib/translate/langs";

// M3.7 / D42 —— 语言，能改回来的地方。M3.9 片 a 从 `/library/vocab` 顶上搬到了 `/settings`。
//
// 为什么非有不可：目标语言是靠**一句问询**定的（第一次遇到非母语内容时问一次，
// 答完即定、不再问），母语更是**自动猜的**。一次性定下、却改不回来，就是死胡同 ——
// D43 定的通则「任何页面都必须有走得出去的路」，在这里的延伸就是
// **任何一次性选择都必须有改回来的地方**。
//
// ⚠️ **这里只有两个选择器，不是计划 C 写的四个。**
//
// 「界面语言」没做：`uiLang` 要等片 b 的文案表落地才真的会改变什么，
// **提前摆一个选了没反应的开关，就是在骗人**（D44 的脾气）。片 b 补上。
//
// 「字幕译文译成」做了又撤了 —— 创始人 2026-08-02 一句话点破：
// **「不是用户在每个视频播放界面就有这个选项吗，直接选那个不就好了」**。他是对的。
// 它和播放器里那一栏是**同一个值**（M3.7 起就存后台了），在这儿再摆一份不增加任何能力，
// 只增加"改哪个才算数"的困惑。设置页最容易长成杂物间，第一件杂物就是这么进来的。

// D42：文案集中在这里，片 d 换 t() 时只动这一处
const COPY = {
  title: "语言",
  native: "我的母语",
  nativeHint: "AI 用它解释、译文译成它",
  target: "我想学的语言",
  targetHint: "留空 = 我只想搞懂内容，不是来学语言的",
  unset: "还没定（看到非母语内容时会问你一次）",
  none: "不学语言，只想搞懂内容",
  saving: "已保存",
};

const UNSET = "__unset";

export function LangSettings({ prefs }: { prefs: LangPrefs }) {
  const router = useRouter();
  const [nativeLang, setNativeLang] = useState(prefs.nativeLang);
  const [targetLang, setTargetLang] = useState<string>(prefs.targetLang ?? UNSET);
  const [saved, setSaved] = useState(false);

  const save = (patch: Record<string, unknown>) => {
    setSaved(false);
    void putSettings(patch).then((ok) => {
      if (!ok) return;
      setSaved(true);
      // 词库该标什么由这两个值决定 —— 改完让页面重新取一次，别拿旧的接着渲染
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="lang-settings-title" className="rounded-2xl border border-ink-700 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p id="lang-settings-title" className="eyebrow">
          {COPY.title}
        </p>
        {saved && <span className="text-[0.68rem] text-teal-300">{COPY.saving}</span>}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-500">
          <span className="text-ink-300">{COPY.native}</span>
          <select
            value={nativeLang}
            onChange={(e) => {
              setNativeLang(e.target.value);
              // **他亲手选了 = 确认过了**（M3.9 / D42 修订①）。这一位一写下去，
              // /watch 顶上那条「这是自动填的」横幅从此不再出现。
              save({ nativeLang: e.target.value, nativeLangConfirmed: true });
            }}
            className="min-h-11 w-full min-w-0 rounded-xl border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 outline-none focus:border-teal-400"
          >
            {/* 母语还没探到时留一个空选项，别让它假装选中了第一门语言 */}
            {!nativeLang && <option value="">—</option>}
            {TARGET_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <span>{COPY.nativeHint}</span>
        </label>

        <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-500">
          <span className="text-ink-300">{COPY.target}</span>
          <select
            value={targetLang}
            onChange={(e) => {
              const v = e.target.value;
              setTargetLang(v);
              // UNSET 只是"还没问过"的显示态，不该被存回去 —— 存空串就是「问过了、不学语言」
              save({ targetLang: v === UNSET ? "" : v });
            }}
            className="min-h-11 w-full min-w-0 rounded-xl border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 outline-none focus:border-teal-400"
          >
            {prefs.targetLang === null && <option value={UNSET}>{COPY.unset}</option>}
            <option value="">{COPY.none}</option>
            {TARGET_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <span>{COPY.targetHint}</span>
        </label>
      </div>
    </section>
  );
}

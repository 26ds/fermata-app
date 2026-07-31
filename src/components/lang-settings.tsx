"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LangPrefs } from "@/lib/lang";
import { putSettings } from "@/lib/settings-client";
import { TARGET_LANGS } from "@/lib/translate/langs";

// M3.7 / D42 —— 母语与目标语言，能改回来的地方。
//
// 为什么非有不可：目标语言是靠**一句问询**定下来的（第一次遇到非母语内容时问一次，
// 答完即定、不再问）。那一句答错了却改不回来，就是另一种死胡同 ——
// D43 定的通则「任何页面都必须有走得出去的路」，在这里的延伸就是
// **任何一次性选择都必须有改回来的地方**。
//
// 完整设置页（界面语言、译文语言…）是 M3.9 的事，这里只放这两个必需的。

// D42：文案集中在这里，M3.9 抽语言表时只动这一处
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
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          <span className="text-ink-300">{COPY.native}</span>
          <select
            value={nativeLang}
            onChange={(e) => {
              setNativeLang(e.target.value);
              save({ nativeLang: e.target.value });
            }}
            className="min-h-11 rounded-xl border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 outline-none focus:border-teal-400"
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

        <label className="flex flex-col gap-1 text-xs text-ink-500">
          <span className="text-ink-300">{COPY.target}</span>
          <select
            value={targetLang}
            onChange={(e) => {
              const v = e.target.value;
              setTargetLang(v);
              // UNSET 只是"还没问过"的显示态，不该被存回去 —— 存空串就是「问过了、不学语言」
              save({ targetLang: v === UNSET ? "" : v });
            }}
            className="min-h-11 rounded-xl border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 outline-none focus:border-teal-400"
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

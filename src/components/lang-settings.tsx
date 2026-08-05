"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/components/copy-provider";
import { UI_LOCALES, resolveUiLocale } from "@/lib/copy";
import { langLabel, normalizeLang, type LangPrefs } from "@/lib/lang";
import { putSettings } from "@/lib/settings-client";
import { TARGET_LANGS } from "@/lib/translate/langs";

// M3.7 / D42 —— 语言，能改回来的地方。M3.9 片 a 从 `/library/vocab` 顶上搬到了 `/settings`。
//
// 为什么非有不可：目标语言是靠**一句问询**定的（第一次遇到非母语内容时问一次，
// 答完即定、不再问），母语更是**自动猜的**。一次性定下、却改不回来，就是死胡同 ——
// D43 定的通则「任何页面都必须有走得出去的路」，在这里的延伸就是
// **任何一次性选择都必须有改回来的地方**。
//
// ⚠️ **三个选择器，不是计划 C 写的四个。**
//
// 「界面语言」片 b 补上了 —— 片 a 当时故意没做，因为 `uiLang` 要等文案表落地才真的
// 会改变什么，**提前摆一个选了没反应的开关就是在骗人**（D44 的脾气）。现在它真的管用了。
//
// 「字幕译文译成」做了又撤了 —— 创始人 2026-08-02 一句话点破：
// **「不是用户在每个视频播放界面就有这个选项吗，直接选那个不就好了」**。他是对的。
// 它和播放器里那一栏是**同一个值**（M3.7 起就存后台了），在这儿再摆一份不增加任何能力，
// 只增加"改哪个才算数"的困惑。设置页最容易长成杂物间，第一件杂物就是这么进来的。
//
// M3.9 片 b：本文件是**第一个吃文案表的组件**（`COPY` 常量已删，全部走 `t()`）——
// 选了「English」之后当场变英文的正是这一块，端到端的证据就在这儿。

const UNSET = "__unset";
/** 界面语言选择器里「跟着我的母语」那一项。存进去是空串（D42：留空才会跟着母语走） */
const FOLLOW_NATIVE = "";

export function LangSettings({ prefs }: { prefs: LangPrefs }) {
  const t = useCopy();
  const router = useRouter();
  const [nativeLang, setNativeLang] = useState(prefs.nativeLang);
  const [targetLang, setTargetLang] = useState<string>(prefs.targetLang ?? UNSET);
  const [uiLang, setUiLang] = useState(prefs.uiLang);
  const [saved, setSaved] = useState(false);

  // 界面语言现在到底落在哪一档 —— 三种，各说各的（D44：不许合并成一句笼统的）。
  // 用**当前选中的值**算，不等服务端回来：选完立刻就该看见这句话变，
  // 而"整个界面跟着变"要等一趟往返，两者差的那半秒正是最容易让人以为坏了的时候。
  const uiNote = (() => {
    if (uiLang) return t("settings.lang.uiFixed", langLabel(resolveUiLocale(uiLang)));
    if (!nativeLang) return t("settings.lang.uiHint"); // 母语还没探到，没什么可说的
    const actual = resolveUiLocale(nativeLang);
    // **必须比精确码，不能比"能不能匹配上"**：母语「繁體中文」是能匹配到简体的，
    // 但那时界面是简体不是繁体 —— 说成"跟着母语走"就是撒谎。这正是创始人撞到的那一格。
    return normalizeLang(nativeLang) === actual
      ? t("settings.lang.uiFollow", langLabel(actual))
      : t("settings.lang.uiFallback", langLabel(nativeLang), langLabel(actual));
  })();

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
          {t("settings.lang.title")}
        </p>
        {saved && <span className="text-[0.68rem] text-teal-300">{t("settings.lang.saved")}</span>}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-500">
          <span className="text-ink-300">{t("settings.lang.native")}</span>
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
          <span>{t("settings.lang.nativeHint")}</span>
        </label>

        <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-500">
          <span className="text-ink-300">{t("settings.lang.target")}</span>
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
            {prefs.targetLang === null && (
              <option value={UNSET}>{t("settings.lang.targetUnset")}</option>
            )}
            <option value="">{t("settings.lang.targetNone")}</option>
            {TARGET_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <span>{t("settings.lang.targetHint")}</span>
        </label>

        {/* 界面语言（M3.9 片 b）。**只列真有整套人工文案的语言** —— 现在是简体中文和
            English 两套。`TARGET_LANGS` 那 15 种是给"母语/想学的语言"用的，
            照搬到这里就会出现「选了 ไทย，界面还是英文」这种选了等于没选的选项（D44）。
            所以这里按 `UI_LOCALES` 过滤，并在下面一行小字里如实说清楚。 */}
        <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-500">
          <span className="text-ink-300">{t("settings.lang.ui")}</span>
          <select
            value={uiLang}
            onChange={(e) => {
              const v = e.target.value;
              setUiLang(v);
              // 空串 = 跟着母语走（别存一份母语的副本进去，那样以后改母语界面就不跟了）
              save({ uiLang: v });
            }}
            className="min-h-11 w-full min-w-0 rounded-xl border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 outline-none focus:border-teal-400"
          >
            <option value={FOLLOW_NATIVE}>{t("settings.lang.uiFollowNative")}</option>
            {UI_LOCALES.map((code) => (
              <option key={code} value={code}>
                {langLabel(code)}
              </option>
            ))}
          </select>
          {/* D44：**当场说清楚现在落到了哪一种**。原来这里是一句笼统的
              「其余语言会用英文」，2026-08-05 创始人真机反馈他换了母语、界面一直是英文，
              **看不出这是设计还是坏了** —— 看不出来就等于坏了。 */}
          <span>{uiNote}</span>
        </label>
      </div>
    </section>
  );
}

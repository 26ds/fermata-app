"use client";

import { useEffect, useRef, useState } from "react";
import { useCopy } from "@/components/copy-provider";
import type { CopyKey } from "@/lib/copy/keys";
import { readKinds, shownKinds, toggleKind, visibleKinds } from "@/lib/question-kinds";
import type { QuestionKind } from "@/lib/types";

// M3.15 片 d 的另一半 —— 问题下面那一排小标签（D65：语言 / 知识 / 没听清，可多属）。
//
// 创始人 2026-09-23 问「是问完了就可以看到，还是只在后台？」「改标签如何改？」—— 照那天答他的做：
// ① **答完那一拍就看得见**：挂在问答栏里他那句问题的气泡下面（小、灰，不抢答案），互动记录「只看提问」里每一问旁边也有；
// ② **点一下标签 → 这一行展开成全部类别的小开关**（✓ = 现在有的，＋ = 没有的）→ 点一个就加上 / 去掉，**当场存**，不用按保存；点别处或按 Esc 收起；
// ③ 一个都没有（老问题、模型那一次没标）→ 一个淡淡的「＋ 标签」，点开是同一排开关。
// 「语言」只在设了想学的语言时露面（D65 选 A）；藏着的那一类**照样留在库里**，改别的不会把它抹掉（`toggleKind`）。
//
// 颜色：**一律灰**。青色在这一页只答「能点去哪 / 是个捕获点」，叶绿只答「看了几遍」（颜色一物一义）——
// 标签两样都不是。灰底那一档和答案头上的「短版」「看了画面」角标同一个样子（那也是「关于这一轮的一句标注」）。
//
// 字号全写成 em：问答栏里跟着「− 字体 +」（`--chat-fs`）一起缩放，互动记录里跟着那一栏的小字走 —— 字号由调用处在外面那一层定。

/** 两处（问答栏、互动记录）共用的那一套 —— watch-stage 造一份，经 qa-rail 递下来 */
export interface Tagging {
  /** D65 选 A：设了想学的语言才露「语言」 */
  showLanguage: boolean;
  /** 改完之后的整组标签：先改界面、再存，存不上改回去（watch-stage 的 `setQuestionKinds`） */
  onSet: (id: string, kinds: QuestionKind[]) => void;
  /** 哪几问的标签上一次没存上（按 interrupt id） */
  errors: ReadonlyMap<string, string>;
}

const LABEL: Record<QuestionKind, CopyKey> = {
  language: "kinds.language",
  knowledge: "kinds.knowledge",
  misheard: "kinds.misheard",
};

/** 收着时的一个标签 —— 和问答栏答案头上的角标（`TAG`）同一档灰 */
const CHIP = "rounded bg-ink-700/70 px-[0.45em] py-[0.12em] text-ink-300";
/** 展开后「有」的那一格：实一档、带 ✓ —— 不只靠颜色分开有没有 */
const ON = "rounded bg-ink-700 px-[0.45em] py-[0.12em] text-ink-100 transition-colors hover:bg-ink-700/60";
/** 展开后「没有」的那一格：虚线框、带 ＋ */
const OFF =
  "rounded border border-dashed border-ink-500 px-[0.4em] py-[0.05em] text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-300";

export function KindTags({
  kinds,
  showLanguage,
  onChange,
  error,
  align = "end",
  onOpenChange,
  className = "",
}: {
  /** 这一问存着的标签，**原样**递进来（`points[].kinds`）—— 身份不变 = 标签没变，这一格自己记着的「刚点的」就不作废 */
  kinds: unknown;
  /** D65 选 A：设了想学的语言才露「语言」 */
  showLanguage: boolean;
  /** 改完之后的整组（不是「加一个 / 去一个」）。上面负责存、存不上负责改回去 */
  onChange: (next: QuestionKind[]) => void;
  /** 上一次没存上（D44：说清楚，而且已经改回去了） */
  error?: string;
  /** 问答栏里靠右（贴着右边的气泡），互动记录里靠左 */
  align?: "end" | "start";
  /** 展开 / 收起。互动记录用它：按标签筛着的时候，正在改的那一问不许一去掉标签就从列表里消失 */
  onOpenChange?: (open: boolean) => void;
  /** 字号在这儿定（里面全是 em） */
  className?: string;
}) {
  const t = useCopy();
  const [open, setOpen] = useState(false);

  // 点下去这一格**先自己变**（只重画这一小格）；上面那份 `points` 在 transition 里跟上 ——
  // 一点就整页重画（字幕、捕获轴、两个栏）是修补轮量过的 INP 坑。上面的值一变（存上了 / 改回去了）就以上面为准
  const [seen, setSeen] = useState(kinds);
  const [local, setLocal] = useState<QuestionKind[] | null>(null);
  if (kinds !== seen) {
    setSeen(kinds);
    setLocal(null);
  }
  const cur = local ?? readKinds(kinds);
  const shown = shownKinds(cur, showLanguage);
  const label = (k: QuestionKind) => t(LABEL[k]);

  const rootRef = useRef<HTMLSpanElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  /** 用 Esc 收起的：焦点还给那一行，别让键盘用户掉回页面顶上 */
  const refocusRef = useRef(false);

  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const show = (next: boolean) => {
    setOpen(next);
    onOpenChangeRef.current?.(next);
  };

  useEffect(() => {
    if (!open) {
      if (refocusRef.current) {
        refocusRef.current = false;
        openerRef.current?.focus();
      }
      return;
    }
    firstRef.current?.focus({ preventScroll: true });
    // 这两个监听里只碰 setState 和 ref（都是稳定的），所以依赖里只有 `open`
    const close = () => {
      setOpen(false);
      onOpenChangeRef.current?.(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      refocusRef.current = true;
      close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const flip = (k: QuestionKind) => {
    const next = toggleKind(cur, k);
    setLocal(next);
    onChange(next);
  };

  const justify = align === "end" ? "justify-end" : "justify-start";

  return (
    <span ref={rootRef} className={`inline-flex max-w-full flex-col ${align === "end" ? "items-end" : "items-start"} ${className}`}>
      {open ? (
        <span role="group" aria-label={t("kinds.groupAria")} className={`flex flex-wrap items-center gap-[0.35em] ${justify}`}>
          {visibleKinds(showLanguage).map((k, i) => {
            const on = cur?.includes(k) ?? false;
            return (
              <button
                key={k}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                aria-pressed={on}
                onClick={() => flip(k)}
                className={on ? ON : OFF}
              >
                <span aria-hidden>{on ? "✓ " : "＋ "}</span>
                {label(k)}
              </button>
            );
          })}
        </span>
      ) : (
        <button
          ref={openerRef}
          type="button"
          onClick={() => show(true)}
          aria-expanded={false}
          aria-label={t("kinds.editAria", shown.map(label).join(t("kinds.listSep")))}
          className={`group/kinds flex flex-wrap items-center gap-[0.35em] rounded ${justify}`}
        >
          {shown.length > 0 ? (
            shown.map((k) => (
              <span key={k} className={`${CHIP} transition-colors group-hover/kinds:text-ink-100`}>
                {label(k)}
              </span>
            ))
          ) : (
            <span className="rounded px-[0.2em] text-ink-500 opacity-70 transition-opacity group-hover/kinds:opacity-100">
              {t("kinds.add")}
            </span>
          )}
        </button>
      )}
      {error ? (
        <span role="alert" className={`mt-[0.3em] block text-amber-300/90 ${align === "end" ? "text-right" : "text-left"}`}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

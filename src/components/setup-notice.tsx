import { getT } from "@/lib/ui-lang";

// 环境变量未配置时的引导页（只在开发者第一次跑起来时出现，不属于产品 UI）。
//
// M3.9 片 c 仍然把它收进了文案表：它虽然罕见，但**真出现的时候是整个屏幕**，
// 一个英文用户碰上它会看到一整页读不懂的中文，还以为网站坏了。
export async function SetupNotice() {
  const t = await getT();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-ink-700 p-6">
        <h1 className="text-lg font-semibold text-teal-300">{t("setup.title")}</h1>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink-300">
          <li>{t("setup.step1")}</li>
          <li>
            {t("setup.step2a")} <code className="text-ink-100">.env.example</code>{" "}
            {t("setup.step2b")} <code className="text-ink-100">.env.local</code>
            {t("setup.step2c")}
          </li>
          <li>
            {t("setup.step3a")}{" "}
            <code className="text-ink-100">supabase/migrations/0001_init.sql</code>
          </li>
          <li>{t("setup.step4")}</li>
        </ol>
        <p className="mt-4 text-xs text-ink-500">{t("setup.more")}</p>
      </div>
    </main>
  );
}

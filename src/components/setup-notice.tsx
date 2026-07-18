// 环境变量未配置时的引导页（只在开发者第一次跑起来时出现，不属于产品 UI）
export function SetupNotice() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-ink-700 p-6">
        <h1 className="text-lg font-semibold text-teal-300">
          还差一步：连接 Supabase
        </h1>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink-300">
          <li>
            在 supabase.com 创建项目，打开 Project Settings → API Keys
          </li>
          <li>
            把项目根目录的 <code className="text-ink-100">.env.example</code>{" "}
            复制为 <code className="text-ink-100">.env.local</code>
            ，填入 Project URL 和 anon public key
          </li>
          <li>
            在 Supabase SQL Editor 里运行{" "}
            <code className="text-ink-100">supabase/migrations/0001_init.sql</code>
          </li>
          <li>重启 npm run dev</li>
        </ol>
        <p className="mt-4 text-xs text-ink-500">详细步骤见 README.md</p>
      </div>
    </main>
  );
}

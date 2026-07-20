"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// M1a — 贴链接导入。只记指针，不碰媒体文件。
export function ImportForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "导入失败，请重试");
        setBusy(false);
        return;
      }
      router.push(`/watch/${data.id}`);
    } catch {
      setError("网络不通，检查一下连接再试");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="source-url" className="text-xs font-semibold tracking-wide text-ink-300">
        贴一条链接
      </label>
      <input
        id="source-url"
        type="url"
        required
        inputMode="url"
        autoComplete="off"
        placeholder="YouTube / 小宇宙 / Apple Podcasts…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="h-14 rounded-xl border border-ink-500/70 bg-ink-900 px-4 text-ink-100 placeholder:text-ink-500 outline-none focus:border-teal-400"
      />
      <button
        type="submit"
        disabled={busy || url.trim().length === 0}
        className="flex h-14 items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 font-semibold text-teal-950 disabled:opacity-50"
      >
        {busy ? "正在导入…" : "开始看"}
        {!busy && <span aria-hidden>→</span>}
      </button>
      <p className="text-xs leading-5 text-ink-500">
        播客直接从 App 里**分享这一集**、把链接贴过来就行（小宇宙、Apple Podcasts 等）。
        贴节目主页或 RSS 也认，那会导入最新一集。
      </p>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

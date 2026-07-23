import { NextResponse } from "next/server";
import { z } from "zod";
import { AskError } from "@/lib/ask/gemini-ask";
import { compactChat, type ChatTurn } from "@/lib/ask/gemini-chat";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow } from "@/lib/types";

// M3 Phase-2 —— 把「本次会话新增的逐轮」浓缩进 summary（给 AI 当往期背景，不喂逐字）。
// 前端在**退出**沉浸聊天时调；**进入**时也调一次兜底（万一上次强退没跑成）。
// 幂等：没有未浓缩的新逐轮就直接返回旧 summary，不烧一次调用。

export const maxDuration = 120;

const schema = z.object({ sourceId: z.string().uuid() });

type ChatRow = {
  id: string;
  messages: ChatTurn[] | null;
  summary: string | null;
  summarized_upto: number | null;
};

export async function POST(request: Request) {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  const { sourceId } = parsed.data;

  const { data } = await supabase
    .from("chats")
    .select("id, messages, summary, summarized_upto")
    .eq("user_id", user.id)
    .eq("source_id", sourceId)
    .maybeSingle();
  const chat = (data as ChatRow) ?? null;
  if (!chat) return NextResponse.json({ ok: true, summary: null }); // 还没聊过，无事可做

  const messages: ChatTurn[] = Array.isArray(chat.messages) ? chat.messages : [];
  const upto = chat.summarized_upto ?? 0;
  const turns = messages.slice(upto);
  if (turns.length === 0) {
    return NextResponse.json({ ok: true, summary: chat.summary ?? null }); // 没有新逐轮，幂等返回
  }

  // 视频标题（compact 提示词用，可空）
  const { data: srcRow } = await supabase
    .from("sources")
    .select("title")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();
  const title = (srcRow as Pick<SourceRow, "title"> | null)?.title ?? null;

  let summary: string;
  try {
    summary = await compactChat({ priorSummary: chat.summary ?? null, turns, title });
  } catch (e) {
    const message = e instanceof AskError ? e.message : "浓缩这次对话时出错了，稍后再试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await supabase
    .from("chats")
    .update({
      summary,
      summarized_upto: messages.length, // 到目前为止的都折进去了
      summary_updated_at: new Date().toISOString(),
    })
    .eq("id", chat.id)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true, summary });
}

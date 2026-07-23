import { NextResponse } from "next/server";
import { z } from "zod";
import { AskError } from "@/lib/ask/gemini-ask";
import { askChat, type ChatTurn } from "@/lib/ask/gemini-chat";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { SourceRow, TranscriptSegment } from "@/lib/types";

// M3 Phase-2 长问答沉浸聊天 —— 每个(用户×视频)一条延续对话。
//
// GET  ?sourceId=  进入时取逐字历史 messages（给用户看）+ summary（往期重点）。
// POST { sourceId, question, atS } 问一轮：取/建 chat 行 → context = summary + 本次实时几轮
//   (messages.slice(summarized_upto)) + 当前播放头字幕 + 全文 → 流式答 → append 两轮到 messages。
// 都是个人数据，RLS 只许本人（表见迁移 0006）。需先跑迁移 0006 才能用。

export const maxDuration = 300;

type ChatRow = {
  id: string;
  messages: ChatTurn[] | null;
  summary: string | null;
  summarized_upto: number | null;
};

const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
} as const;

function line(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

const postSchema = z.object({
  sourceId: z.string().uuid(),
  question: z.string().trim().min(1, "先写一句想问的").max(4000),
  atS: z.number().min(0).max(24 * 3600),
});

// ── GET：进入时取历史 ──
export async function GET(request: Request) {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const sourceId = new URL(request.url).searchParams.get("sourceId");
  if (!sourceId) return NextResponse.json({ error: "缺少 sourceId" }, { status: 400 });

  const { data } = await supabase
    .from("chats")
    .select("messages, summary, summarized_upto")
    .eq("user_id", user.id)
    .eq("source_id", sourceId)
    .maybeSingle();

  const row = data as Pick<ChatRow, "messages" | "summary" | "summarized_upto"> | null;
  return NextResponse.json({
    messages: row?.messages ?? [],
    summary: row?.summary ?? null,
    summarizedUpto: row?.summarized_upto ?? 0,
  });
}

// ── POST：问一轮 ──
export async function POST(request: Request) {
  if (!supabaseConfigured) return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error?.issues[0]?.message ?? "请求参数不合法" },
      { status: 400 },
    );
  }
  const { sourceId, question, atS } = parsed.data;

  // 内容 + 字幕
  const { data: srcRow } = await supabase
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!srcRow) return NextResponse.json({ error: "找不到这条内容" }, { status: 404 });
  const source = srcRow as SourceRow;
  const segments: TranscriptSegment[] = Array.isArray(source.transcript) ? source.transcript : [];
  if (segments.length === 0) {
    return NextResponse.json({ error: "这条内容还没有字幕，先生成字幕再聊。" }, { status: 400 });
  }

  // 取/建这条视频的 chat 行
  let chat: ChatRow | null = null;
  {
    const { data } = await supabase
      .from("chats")
      .select("id, messages, summary, summarized_upto")
      .eq("user_id", user.id)
      .eq("source_id", sourceId)
      .maybeSingle();
    chat = (data as ChatRow) ?? null;
  }
  if (!chat) {
    const { data, error } = await supabase
      .from("chats")
      .insert({ user_id: user.id, source_id: sourceId, messages: [], summarized_upto: 0 })
      .select("id, messages, summary, summarized_upto")
      .single();
    if (error || !data) {
      // 并发下另一路已插入 → 再取一次
      const { data: again } = await supabase
        .from("chats")
        .select("id, messages, summary, summarized_upto")
        .eq("user_id", user.id)
        .eq("source_id", sourceId)
        .maybeSingle();
      chat = (again as ChatRow) ?? null;
    } else {
      chat = data as ChatRow;
    }
  }
  if (!chat) return NextResponse.json({ error: "建立对话失败，请重试" }, { status: 500 });

  const chatRow = chat;
  const existing: ChatTurn[] = Array.isArray(chatRow.messages) ? chatRow.messages : [];
  const upto = chatRow.summarized_upto ?? 0;
  // 本次会话的实时几轮 = 还没折进 summary 的那部分
  const liveTurns = existing.slice(upto);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: unknown) => {
        try {
          controller.enqueue(line(payload));
        } catch {
          /* 浏览器走了不影响服务端把答案收完再落库 */
        }
      };

      try {
        const answer = await askChat({
          question,
          segments,
          atS,
          title: source.title,
          priorSummary: chatRow.summary ?? null,
          liveTurns,
          onChunk: async (text) => push({ type: "chunk", text }),
        });

        // append 两条逐字到 messages（给用户看；AI 下次吃的是 summary）
        const nextMessages: ChatTurn[] = [
          ...existing,
          { role: "user", text: question, at_s: atS },
          { role: "assistant", text: answer, at_s: atS },
        ];
        await supabase
          .from("chats")
          .update({ messages: nextMessages, updated_at: new Date().toISOString() })
          .eq("id", chatRow.id)
          .eq("user_id", user.id);

        push({ type: "done", answer });
      } catch (e) {
        const message =
          e instanceof AskError
            ? e.message
            : `回答时出错了：${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
        push({ type: "error", message });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

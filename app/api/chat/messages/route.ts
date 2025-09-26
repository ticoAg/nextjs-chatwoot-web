import { NextRequest } from "next/server";
import ChatwootClient, { ChatwootAPI } from "@figuro/chatwoot-sdk/dist";

function getClient() {
  const basePath = process.env.base_url as string;
  const config = { ...ChatwootAPI, basePath, with_credentials: false };
  return new ChatwootClient({ config }) as any;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contactIdentifier = searchParams.get("contactIdentifier");
    const conversationId = searchParams.get("conversationId");
    const inboxIdentifier = process.env.inbox_identifier as string;
    if (!contactIdentifier || !conversationId || !inboxIdentifier) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400 });
    }
    const cw = getClient();
    const msgs = await cw.client.messages.list({
      inboxIdentifier,
      contactIdentifier,
      conversationId,
    });
    return Response.json(msgs || []);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "List failed" }), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contactIdentifier, conversationId, content } = body || {};
    const inboxIdentifier = process.env.inbox_identifier as string;
    if (!contactIdentifier || !conversationId || !content) {
      return new Response(JSON.stringify({ error: "Missing body fields" }), { status: 400 });
    }
    const cw = getClient();
    const res = await cw.client.messages.create({
      inboxIdentifier,
      contactIdentifier,
      conversationId,
      data: { content, echo_id: `${Date.now()}` },
    });
    return Response.json(res);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Create failed" }), { status: 500 });
  }
}

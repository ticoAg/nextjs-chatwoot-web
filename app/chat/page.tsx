"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ActionCable from "@rails/actioncable";
import { Input, Button, Tag, Typography } from "antd";
const { Text } = Typography;
import type {
	public_contact,
	public_conversation,
	public_message,
	message as CableMessage,
} from "@figuro/chatwoot-sdk/dist";

function toMillis(ts: any): number {
    if (ts == null) return Date.now();
    if (typeof ts === "number") {
        return ts < 1e12 ? ts * 1000 : ts;
    }
    if (typeof ts === "string") {
        const n = Number(ts);
        if (!Number.isNaN(n)) {
            return n < 1e12 ? n * 1000 : n;
        }
        const parsed = Date.parse(ts);
        return Number.isNaN(parsed) ? Date.now() : parsed;
    }
    return Date.now();
}

function mapMessageType(raw: any, sender: any): "incoming" | "outgoing" | "activity" | "template" {
    let t: string = "text";
    if (typeof raw === "number") {
        // Chatwoot sometimes uses numeric enums: 0=incoming, 1=outgoing, 2=activity
        t = raw === 0 ? "incoming" : raw === 1 ? "outgoing" : raw === 2 ? "activity" : "text";
    } else if (typeof raw === "string") {
        // Handle stringified numbers and proper strings
        if (raw === "0") t = "incoming";
        else if (raw === "1") t = "outgoing";
        else if (raw === "2") t = "activity";
        else t = raw as any;
    }
    const role = (sender && (sender.role as string)) || "";
    const type = (sender && (sender.type as string)) || ""; // e.g., "contact" for visitors
    const isAgent = role === "agent" || role === "administrator";
    const isContact = type === "contact";
    // If a contact (visitor) message is marked as outgoing, treat it as incoming for the widget
    if (isContact && t === "outgoing") return "incoming";
    // If an agent message is marked as incoming, treat it as outgoing
    if (isAgent && t === "incoming") return "outgoing";
    // Default
    if (t === "text") return "incoming"; // safest default for user view
    return t as any;
}

// Client-side fetch helpers for our server API wrappers
const bootChat = async (contactIdentifier?: string) => {
	const res = await fetch("/api/chat/boot", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ contactIdentifier }),
	});
	if (!res.ok) throw new Error(await res.text());
	return (await res.json()) as {
		contact: public_contact;
		conversation: public_conversation;
	};
};

const listMessages = async (
	contactIdentifier: string,
	conversationId: string
) => {
	const u = new URL(window.location.origin + "/api/chat/messages");
	u.searchParams.set("contactIdentifier", contactIdentifier);
	u.searchParams.set("conversationId", conversationId);
	const res = await fetch(u);
	if (!res.ok) throw new Error(await res.text());
	return (await res.json()) as public_message[];
};

const sendMessage = async (
	contactIdentifier: string,
	conversationId: string,
	content: string
) => {
	const res = await fetch("/api/chat/messages", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ contactIdentifier, conversationId, content }),
	});
	if (!res.ok) throw new Error(await res.text());
	return (await res.json()) as public_message;
};

type BootState = {
	contact?: public_contact;
	conversation?: public_conversation;
};

type DisplayMessage = {
    id: string;
    content?: string;
    content_type?: "text" | "input_select" | "cards" | "form";
    message_type?: "incoming" | "outgoing" | "activity" | "template";
    created_at?: number;
    attachments?: Array<any>;
    conversation_id?: string | number;
    sender?: any;
};

function normalizePublic(msg: public_message): DisplayMessage {
    const anyMsg = msg as any;
    // Prefer source_id for dedupe across WS + HTTP responses
    const id = String(
        anyMsg.source_id || msg.id || msg.conversation_id || Date.now()
    );
    // Some client API responses may mark contact-sent messages as "outgoing" but
    // without a sender object; normalize those to "incoming" for visitor view.
    const message_type = mapMessageType((msg as any).message_type, anyMsg.sender);
    return {
        id,
        content: msg.content,
        content_type: (msg.content_type as any) || "text",
        message_type,
        attachments: msg.attachments || [],
        created_at: toMillis(anyMsg.created_at),
        conversation_id: msg.conversation_id,
        sender: anyMsg.sender,
    };
}

function normalizeCable(msg: CableMessage): DisplayMessage {
    const anyMsg = msg as any;
    const stableId = anyMsg.source_id || anyMsg.id;
    const fallbackId = `${anyMsg.conversation_id || ""}:${anyMsg.created_at || ""}:${
        anyMsg.content || ""
    }`;
    const message_type = mapMessageType((anyMsg as any).message_type, anyMsg.sender);
    return {
        id: String(stableId || fallbackId || Date.now()),
        content: anyMsg.content,
        content_type: anyMsg.content_type,
        message_type,
        attachments: anyMsg.attachment ? [anyMsg.attachment] : [],
        created_at: toMillis(anyMsg.created_at),
        conversation_id: anyMsg.conversation_id,
        sender: anyMsg.sender,
    };
}

export default function ChatPage() {
	const [boot, setBoot] = useState<BootState>({});
	const [messages, setMessages] = useState<DisplayMessage[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const cableRef = useRef<ReturnType<typeof ActionCable.createConsumer> | null>(
		null
	);
	const subRef = useRef<ActionCable.Subscription | null>(null);
	const [wsStatus, setWsStatus] = useState<
		"idle" | "connecting" | "connected" | "disconnected" | "rejected"
	>("idle");

	const inboxIdentifier = process.env
		.NEXT_PUBLIC_CHATWOOT_INBOX_IDENTIFIER as string;
	// anonymous session: persist contact_identifier in localStorage
	const storageKey = `cw_contact_${inboxIdentifier}`;

	useEffect(() => {
		const run = async () => {
			try {
				setLoading(true);
				const baseName =
					typeof window !== "undefined" ? window.navigator.userAgent : "web";
				let contactIdentifier = "";
				if (typeof window !== "undefined") {
					contactIdentifier = localStorage.getItem(storageKey) || "";
				}

				const { contact, conversation } = await bootChat(
					contactIdentifier || undefined
				);
				contactIdentifier = contact.source_id || "";
				if (contactIdentifier && typeof window !== "undefined") {
					localStorage.setItem(storageKey, contactIdentifier);
				}
				setBoot({ contact, conversation });

				const msgs = await listMessages(
					contactIdentifier,
					String(conversation.id || "")
				);
				setMessages((msgs || []).map(normalizePublic));
				setError(null);
			} catch (e: any) {
				console.error(e);
				setError(e?.message || "初始化失败");
			} finally {
				setLoading(false);
			}
		};
		run();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [inboxIdentifier]);

	useEffect(() => {
		if (!scrollerRef.current) return;
		scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
	}, [messages.length]);

  const sendContent = async (content: string) => {
    if (!content.trim() || !boot.contact || !boot.conversation) return;
    try {
      const contactIdentifier = boot.contact.source_id as string;
      const conversationId = String(boot.conversation.id || "");
      const echo_id = `${Date.now()}`;

      const optimistic: DisplayMessage = {
        id: echo_id,
        content,
        message_type: "incoming",
        conversation_id: conversationId,
        created_at: Date.now(),
      };
      setMessages((m) => [...m, optimistic]);

      const res = await sendMessage(contactIdentifier, conversationId, content);
      // If server echoes via WS, we might get a duplicate. Replace optimistic by matching echo_id/source_id.
      const canonical = normalizePublic(res as any);
      setMessages((m) =>
        m.map((msg) => (msg.id === echo_id || msg.id === (res as any)?.source_id ? canonical : msg))
      );
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "发送失败");
    }
  };

  const onSend = async () => {
    if (!input.trim()) return;
    const text = input;
    setInput("");
    await sendContent(text);
  };

	// Realtime via ActionCable RoomChannel
	useEffect(() => {
		const token = boot.contact?.pubsub_token;
		const conversationId = boot.conversation?.id;
		if (!token || !conversationId) return;

		try {
			setWsStatus("connecting");
			const base = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL as string;
			const wsBase = base.replace(/^http(s?):/, "ws$1:");
			const consumer = ActionCable.createConsumer(`${wsBase}/cable`);
			cableRef.current = consumer;
			const subscription = consumer.subscriptions.create(
				{ channel: "RoomChannel", pubsub_token: token },
				{
					connected: () => setWsStatus("connected"),
					disconnected: () => setWsStatus("disconnected"),
					rejected: () => setWsStatus("rejected"),
					received: async (data: any) => {
						try {
							// Try message formats: Chatwoot broadcasts various shapes
							const raw = (data &&
								(data.message ||
									data.payload ||
									data.data ||
									data.event ||
									data)) as any;
							const convId = String(conversationId);
							let dm: DisplayMessage | null = null;
							if (
								raw &&
								(raw.source_id || raw.content_type || raw.message_type)
							) {
								const cableMsg = raw as CableMessage;
								if (String(cableMsg.conversation_id || "") === convId)
									dm = normalizeCable(cableMsg);
							} else if (raw && (raw.id || raw.conversation_id)) {
								const pubMsg = raw as public_message;
								if (String(pubMsg.conversation_id || "") === convId)
									dm = normalizePublic(pubMsg);
							}
                        if (dm) {
                            setMessages((prev) => {
                                // Dedupe by id first
                                const byId = prev.findIndex((m) => m.id === dm!.id);
                                if (byId >= 0) return prev;
                                // Dedupe/merge by content + timestamp proximity (handles echo_id vs source_id)
                                const nearIdx = prev.findIndex((m) => {
                                    const sameConv = String(m.conversation_id || "") === String(dm!.conversation_id || "");
                                    const sameText = (m.content || "") === (dm!.content || "");
                                    const dt = Math.abs((m.created_at || 0) - (dm!.created_at || 0));
                                    return sameConv && sameText && dt < 5000; // within 5s window
                                });
                                if (nearIdx >= 0) {
                                    const cloned = [...prev];
                                    cloned[nearIdx] = dm!;
                                    return cloned;
                                }
                                return [...prev, dm!];
                            });
                        } else {
								// Fallback: refresh messages
								const contactIdentifier = boot.contact?.source_id as string;
								const msgs = await listMessages(contactIdentifier, convId);
								setMessages((msgs || []).map(normalizePublic));
							}
						} catch (e) {
							// swallow
						}
					},
				}
			);
			subRef.current = subscription;
			return () => {
				try {
					subscription.unsubscribe();
				} catch {}
				try {
					consumer.disconnect();
				} catch {}
				cableRef.current = null;
				subRef.current = null;
				setWsStatus("disconnected");
			};
		} catch (e) {
			setWsStatus("disconnected");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [boot.contact?.pubsub_token, boot.conversation?.id]);

    // Poll for new messages every 5s (backup to WS). Disable when WS is connected.
    useEffect(() => {
        if (!boot.contact || !boot.conversation) return;
        if (wsStatus === "connected") return;
        const contactIdentifier = boot.contact.source_id as string;
        const conversationId = String(boot.conversation.id || "");
        const t = setInterval(async () => {
            try {
                const msgs = await listMessages(contactIdentifier, conversationId);
                setMessages((msgs || []).map(normalizePublic));
            } catch (e) {
                // ignore transient errors
            }
        }, 5000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boot.contact?.source_id, boot.conversation?.id, wsStatus]);

	return (
    <div className="mx-auto max-w-2xl w-full p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-2xl font-semibold">客服对话</div>
        <div className="text-xs text-zinc-500">WS: {wsStatus}</div>
      </div>

			{loading && <div>加载中...</div>}
			{error && <div className="text-red-600 text-sm">{error}</div>}

			{!loading && (
				<>
          <div
            ref={scrollerRef}
            className="rounded-xl h-[60vh] overflow-y-auto p-3 bg-white dark:bg-zinc-900 border border-zinc-200 shadow-sm"
          >
            {messages.map((m) => (
              <MessageItem key={m.id} msg={m} onQuickReply={(t) => sendContent(t)} />
            ))}
						{messages.length === 0 && (
							<div className="text-zinc-500 text-sm">
								暂无消息，开始对话吧。
							</div>
						)}
					</div>

          <div className="flex gap-2 sticky bottom-4">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息..."
              onPressEnter={(e) => {
                e.preventDefault();
                onSend();
              }}
            />
            <Button type="primary" onClick={onSend} disabled={!input.trim()}>
              发送
            </Button>
          </div>
				</>
			)}
		</div>
	);
}

function MessageItem({ msg, onQuickReply }: { msg: DisplayMessage; onQuickReply?: (text: string) => void }) {
    const isActivity = msg.message_type === "activity";
    const senderType = (msg as any)?.sender?.type as string | undefined;
    const isMine = !isActivity && (senderType === "contact" || msg.message_type === "incoming");
    const bubbleClass = isActivity
        ? "bg-zinc-100 text-zinc-700"
        : isMine
        ? "bg-blue-600 text-white"
        : "bg-gray-100 text-black";
    const alignClass = isActivity
        ? "justify-center"
        : isMine
        ? "justify-end"
        : "justify-start";
	return (
		<div className={`flex ${alignClass} mb-3`}>
			<div className={`max-w-[80%] rounded-2xl px-4 py-2 ${bubbleClass}`}>
        <div className="flex items-center gap-2 mb-1">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(msg.created_at || Date.now()).toLocaleString()}
          </Text>
          {isMine ? <Tag color="blue">我</Tag> : isActivity ? <Tag>系统</Tag> : <Tag>客服</Tag>}
        </div>
        <MessageContent msg={msg} onQuickReply={onQuickReply} />
			</div>
		</div>
	);
}

function MessageContent({ msg, onQuickReply }: { msg: DisplayMessage; onQuickReply?: (text: string) => void }) {
	const type = msg.content_type || "text";
	if (type === "text") {
		return <div className="whitespace-pre-wrap leading-6">{msg.content}</div>;
	}
	if (type === "input_select") {
    const opts = (msg as any)?.content_attributes?.options || [];
    return (
      <div>
        <div className="mb-2">{msg.content}</div>
        <div className="flex flex-wrap gap-2">
          {opts.map((o: any) => (
            <button
              key={o.value}
              className="px-3 py-1 rounded-full bg-white/80 border border-zinc-200 text-sm hover:bg-white"
              onClick={() => onQuickReply?.(o.value || o.label)}
            >
              {o.label || o.value}
            </button>
          ))}
        </div>
      </div>
    );
  }
	if (type === "cards") {
		const cards = (msg as any)?.content_attributes?.cards || [];
		return (
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{cards.map((c: any, idx: number) => (
					<div
						key={idx}
						className="rounded-xl overflow-hidden border bg-white text-black"
					>
						{c.image && (
							<img
								src={c.image}
								alt={c.title || "card"}
								className="w-full h-32 object-cover"
							/>
						)}
						<div className="p-3">
							<div className="font-semibold">{c.title}</div>
							<div className="text-sm opacity-80">{c.description}</div>
              {c.actions && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.actions.map((a: any, i: number) => (
                    a?.url ? (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 text-sm">
                        {a.label || "打开"}
                      </a>
                    ) : (
                      <button key={i} className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-sm" onClick={() => onQuickReply?.(a.value || a.label)}>
                        {a.label || "选择"}
                      </button>
                    )
                  ))}
                </div>
              )}
						</div>
					</div>
				))}
			</div>
		);
	}
	if (type === "form") {
		const fields = (msg as any)?.content_attributes?.fields || [];
		return (
			<div>
				<div className="mb-2">{msg.content}</div>
				<div className="space-y-2">
					{fields.map((f: any, idx: number) => (
						<div key={idx} className="flex flex-col">
							<label className="text-xs mb-1 opacity-70">
								{f.label || f.name}
							</label>
							<input
								className="px-2 py-1 rounded border"
								placeholder={f.placeholder || ""}
								disabled
							/>
						</div>
					))}
				</div>
			</div>
		);
	}
	// Fallback including attachments
	if (msg.attachments && msg.attachments.length) {
		return (
			<div>
				{msg.content && (
					<div className="mb-2 whitespace-pre-wrap">{msg.content}</div>
				)}
				{msg.attachments.map((a: any, i: number) => {
					const src = a.data_url || a.url || a.file_url || a.thumb_url;
					const isImage = (a.content_type || a.file_type || "").startsWith(
						"image/"
					);
					if (isImage && src) {
						return (
							<img
								key={i}
								src={src}
								alt={a.file_name || "attachment"}
								className="rounded max-h-60"
							/>
						);
					}
					return (
						<a
							key={i}
							href={src}
							target="_blank"
							rel="noreferrer"
							className="underline"
						>
							{a.file_name || src || "附件"}
						</a>
					);
				})}
			</div>
		);
	}
	return <div className="whitespace-pre-wrap">{msg.content}</div>;
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ActionCable from "@rails/actioncable";
import type {
	public_contact,
	public_conversation,
	public_message,
	message as CableMessage,
} from "@figuro/chatwoot-sdk/dist";

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
};

function normalizePublic(msg: public_message): DisplayMessage {
	return {
		id: String(msg.id || msg.conversation_id || Date.now()),
		content: msg.content,
		content_type: msg.content_type as any,
		message_type: msg.message_type as any,
		attachments: msg.attachments || [],
		created_at: msg.created_at
			? new Date(msg.created_at).getTime()
			: Date.now(),
		conversation_id: msg.conversation_id,
	};
}

function normalizeCable(msg: CableMessage): DisplayMessage {
	return {
		id: String(msg.source_id || Date.now()),
		content: msg.content,
		content_type: msg.content_type,
		message_type: msg.message_type,
		attachments: msg.attachment ? [msg.attachment] : [],
		created_at: msg.created_at ?? Date.now(),
		conversation_id: msg.conversation_id,
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

	const onSend = async () => {
		if (!input.trim() || !boot.contact || !boot.conversation) return;
		try {
			const contactIdentifier = boot.contact.source_id as string;
			const conversationId = String(boot.conversation.id || "");
			const echo_id = `${Date.now()}`;

			// Optimistic UI
			const optimistic: public_message = {
				id: echo_id,
				content: input,
				message_type: "incoming",
				conversation_id: conversationId,
				created_at: new Date().toISOString(),
			};
			setMessages((m) => [...m, optimistic]);
			setInput("");

			const res = await sendMessage(
				contactIdentifier,
				conversationId,
				optimistic.content || ""
			);
			// Replace optimistic if API returns canonical message
			if ((res as any)?.id) {
				const canonical = normalizePublic(res as any);
				setMessages((m) =>
					m.map((msg) => (msg.id === echo_id ? canonical : msg))
				);
			}
		} catch (e: any) {
			console.error(e);
			setError(e?.message || "发送失败");
		}
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
									const exists = prev.some((m) => m.id === dm!.id);
									return exists ? prev : [...prev, dm!];
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

	// Poll for new messages every 5s (backup to WS)
	useEffect(() => {
		if (!boot.contact || !boot.conversation) return;
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
	}, [boot.contact?.source_id, boot.conversation?.id]);

	return (
		<div className="mx-auto max-w-2xl w-full p-4 flex flex-col gap-4">
			<h1 className="text-xl font-semibold">Chatwoot 客服</h1>
			<div className="text-xs text-zinc-500">WebSocket: {wsStatus}</div>

			{loading && <div>加载中...</div>}
			{error && <div className="text-red-600 text-sm">{error}</div>}

			{!loading && (
				<>
					<div
						ref={scrollerRef}
						className="border rounded h-[60vh] overflow-y-auto p-3 bg-white dark:bg-zinc-900"
					>
						{messages.map((m) => (
							<MessageItem key={m.id} msg={m} />
						))}
						{messages.length === 0 && (
							<div className="text-zinc-500 text-sm">
								暂无消息，开始对话吧。
							</div>
						)}
					</div>

					<div className="flex gap-2 sticky bottom-4">
						<input
							className="flex-1 border rounded px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/20"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder="输入消息..."
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									onSend();
								}
							}}
						/>
						<button
							className="px-4 py-2 rounded bg-black text-white disabled:opacity-50 shadow-sm"
							onClick={onSend}
							disabled={!input.trim()}
						>
							发送
						</button>
					</div>
				</>
			)}
		</div>
	);
}

function MessageItem({ msg }: { msg: DisplayMessage }) {
	const isOutgoing = msg.message_type === "outgoing";
	const isActivity = msg.message_type === "activity";
	const bubbleClass = isActivity
		? "bg-zinc-100 text-zinc-700"
		: isOutgoing
		? "bg-black text-white"
		: "bg-zinc-200 text-zinc-900";
	const alignClass = isActivity
		? "justify-center"
		: isOutgoing
		? "justify-end"
		: "justify-start";
	return (
		<div className={`flex ${alignClass} mb-3`}>
			<div className={`max-w-[80%] rounded-2xl px-4 py-2 ${bubbleClass}`}>
				<div className="text-[10px] opacity-70 mb-1">
					{new Date(msg.created_at || Date.now()).toLocaleString()}
				</div>
				<MessageContent msg={msg} />
			</div>
		</div>
	);
}

function MessageContent({ msg }: { msg: DisplayMessage }) {
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
						<span
							key={o.value}
							className="px-3 py-1 rounded-full bg-white/20 border border-white/30 text-sm"
						>
							{o.label || o.value}
						</span>
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
										<a
											key={i}
											href={a.url}
											target="_blank"
											rel="noreferrer"
											className="text-blue-600 text-sm"
										>
											{a.label || "打开"}
										</a>
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

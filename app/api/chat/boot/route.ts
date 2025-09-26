import { NextRequest } from "next/server";
import ChatwootClient, { ChatwootAPI } from "@figuro/chatwoot-sdk/dist";

export async function POST(req: NextRequest) {
	try {
		const { contactIdentifier } = await req
			.json()
			.catch(() => ({ contactIdentifier: "" }));

		const basePath = process.env.base_url as string;
		const inboxIdentifier = process.env.inbox_identifier as string;
		if (!basePath || !inboxIdentifier) {
			return new Response(
				JSON.stringify({ error: "Missing env base_url or inbox_identifier" }),
				{ status: 500 }
			);
		}

    const config = { ...ChatwootAPI, basePath, with_credentials: false };
    const cw = new ChatwootClient({ config }) as any;

		let contact = undefined as
			| Awaited<ReturnType<typeof cw.client.contacts.get>>
			| undefined;

		let cid = contactIdentifier || "";

		if (cid) {
			try {
				contact = await cw.client.contacts.get({
					inboxIdentifier,
					contactIdentifier: cid,
				});
			} catch {
				// fallback to create if get fails
			}
		}

		if (!contact) {
			contact = await cw.client.contacts.create({
				inboxIdentifier,
				data: { name: "Web Visitor", identifier: process.env.user_identifier },
			});
			cid = contact?.source_id || "";
		}

		const list = await cw.client.conversations.list({
			inboxIdentifier,
			contactIdentifier: cid,
		});
		let conversation = list?.[0];
		if (!conversation) {
			conversation = await cw.client.conversations.create({
				inboxIdentifier,
				contactIdentifier: cid,
			});
		}

		return Response.json({ contact, conversation });
	} catch (e: any) {
		return new Response(
			JSON.stringify({ error: e?.message || "Boot failed" }),
			{ status: 500 }
		);
	}
}

import { json, type RequestHandler } from '@sveltejs/kit';
import { getCurrentUser } from '$lib/server/auth';
import { buildBlockingEventICS, upsertCaldavEvent } from '$lib/server/caldav';

export const POST: RequestHandler = async (event) => {
	const userId = await getCurrentUser(event);
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = event.platform?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 500 });

	const userRow = await db
		.prepare('SELECT settings FROM users WHERE id = ?')
		.bind(userId)
		.first<{ settings: string | null }>();

	let settings: any = {};
	try {
		settings = userRow?.settings ? JSON.parse(userRow.settings) : {};
	} catch {
		settings = {};
	}

	const caldav = settings.caldav;

	if (!caldav?.calendarUrl || !caldav?.username || !caldav?.password) {
		return json({ error: 'CalDAV is not connected.' }, { status: 400 });
	}

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const start = new Date(body?.start);
	const end = new Date(body?.end);
	const summary = (body?.summary || 'Blocked') as string;

	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
		return json({ error: 'Invalid start/end.' }, { status: 400 });
	}

	const uid = `${crypto.randomUUID()}@cloudmeet`;
	const ics = buildBlockingEventICS({ uid, startUtc: start, endUtc: end, summary });
	const filename = `${uid}.ics`;

	try {
		await upsertCaldavEvent(
			{ calendarUrl: caldav.calendarUrl, username: caldav.username, password: caldav.password },
			filename,
			ics
		);
		return json({ ok: true });
	} catch (e: any) {
		return json({ error: e?.message || 'Failed to create event.' }, { status: 500 });
	}
};

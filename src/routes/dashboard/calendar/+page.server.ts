import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAuth } from '$lib/server/auth';
import { getCaldavEvents, type CaldavConfig } from '$lib/server/caldav';

function getYmdPartsInTz(d: Date, timeZone: string): { y: number; m: number; d: number } {
	// Robustly get calendar parts in a specific IANA timezone.
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(d);
	const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
	return {
		y: parseInt(get('year') || '0', 10),
		m: parseInt(get('month') || '1', 10),
		d: parseInt(get('day') || '1', 10)
	};
}

export const load: PageServerLoad = async (event) => {
	const userId = await requireAuth(event);
	const db = event.platform?.env?.DB;
	if (!db) throw new Error('Database unavailable');

	const userRow = await db
		.prepare('SELECT slug, settings, timezone FROM users WHERE id = ?')
		.bind(userId)
		.first<{ slug: string; settings: string | null; timezone: string | null }>();

	let settings: any = {};
	try {
		settings = userRow?.settings ? JSON.parse(userRow.settings) : {};
	} catch {
		settings = {};
	}

	const caldav: CaldavConfig | undefined = settings.caldav;
	const tz = userRow?.timezone || settings.timezone || 'UTC';

	const now = new Date();
	const nowParts = getYmdPartsInTz(now, tz);
	const y = parseInt(event.url.searchParams.get('y') || String(nowParts.y));
	const m = parseInt(event.url.searchParams.get('m') || String(nowParts.m)); // 1-12

	// Window: whole month in UTC.
	const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
	const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));

	let events: any[] = [];
	let error: string | null = null;
	if (caldav?.calendarUrl && caldav.username && caldav.password) {
		try {
			events = await getCaldavEvents(caldav, start, end);
		} catch (e: any) {
			error = e?.message || 'Failed to fetch calendar events.';
		}
	}

	// Availability rules (shown as an overlay in the calendar UI)
	const rules = await db
		.prepare(
			`SELECT id, day_of_week, start_time, end_time
			 FROM availability_rules
			 WHERE user_id = ?
			 ORDER BY day_of_week, start_time`
		)
		.bind(userId)
		.all<{ id: number; day_of_week: number; start_time: string; end_time: string }>();

	return {
		slug: userRow?.slug,
		timezone: tz,
		caldavConnected: !!(caldav?.calendarUrl && caldav.username && caldav.password),
		events,
		availabilityRules: rules.results,
		error,
		month: { y, m },
		// Used by the UI to show what range we're fetching.
		windowStart: start.toISOString(),
		windowEnd: end.toISOString()
	};
};

export const actions: Actions = {
	// Keep timezone consistent across the entire dashboard.
	// Availability page also writes to `users.timezone`, so updating it here syncs everything.
	setTimezone: async (event) => {
		const userId = await requireAuth(event);
		const db = event.platform?.env?.DB;
		if (!db) return fail(500, { error: 'Database unavailable' });

		const formData = await event.request.formData();
		const timezone = formData.get('timezone');
		if (!timezone || typeof timezone !== 'string') {
			return fail(400, { error: 'Missing timezone' });
		}

		// Basic sanity check to avoid storing garbage.
		if (!/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(timezone) && timezone !== 'UTC') {
			return fail(400, { error: 'Invalid timezone' });
		}

		await db.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(timezone, userId).run();
		return { success: true };
	}
};

/**
 * Monthly availability API endpoint
 * Returns which dates in a month have available slots.
 *
 * This variant is calendar-source agnostic and currently supports:
 * - iCalendar (.ics) feeds saved in user settings (used to mark busy time)
 * - Existing confirmed bookings in the DB
 *
 * (Google/Outlook integrations are intentionally not included in this repository.)
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCaldavBusyTimes } from '$lib/server/caldav';
import { getAvailabilityRevision } from '$lib/server/availability-revision';

interface TimeSlot {
	start: string;
	end: string;
}

const WEEKDAY_MAP: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6
};

function getDayOfWeekInTimezone(dateStr: string, timezone: string): number {
	// dateStr: YYYY-MM-DD
	const d = new Date(`${dateStr}T12:00:00.000Z`); // noon UTC to avoid edge cases
	const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(d);
	return WEEKDAY_MAP[weekday] ?? d.getUTCDay();
}

// Takes a date string (YYYY-MM-DD) and time string (HH:MM) in user's timezone and returns a UTC Date.
function createDateInTimezone(dateStr: string, timeStr: string, timezone: string): Date {
	const [hour, minute] = timeStr.split(':').map(Number);
	const dateTimeStr = `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});

	// Interpret the local timestamp as if it were UTC, then correct by the timezone offset.
	const targetDate = new Date(dateTimeStr + 'Z');
	const parts = formatter.formatToParts(targetDate);
	const tzHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0');
	const tzMinute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0');

	const targetMinutes = hour * 60 + minute;
	const actualMinutes = tzHour * 60 + tzMinute;
	let offsetMinutes = actualMinutes - targetMinutes;

	// Handle day boundary crossing
	if (offsetMinutes > 12 * 60) offsetMinutes -= 24 * 60;
	if (offsetMinutes < -12 * 60) offsetMinutes += 24 * 60;

	return new Date(targetDate.getTime() - offsetMinutes * 60 * 1000);
}

export const GET: RequestHandler = async ({ url, platform }) => {
	const env = platform?.env;
	if (!env) throw error(500, 'Platform env not available');

	const eventSlug = url.searchParams.get('event');
	const month = url.searchParams.get('month'); // YYYY-MM

	if (!eventSlug || !month) throw error(400, 'Missing required parameters');

	try {
		const db = env.DB;

		// Optional viewer timezone (IANA). Frontend sends `tz` on some routes; accept `timezone` too.
		// Used only to decide which *dates* have availability.
		const tzParam = (url.searchParams.get('tz') || url.searchParams.get('timezone') || '').trim();

		const user = await db
			.prepare('SELECT id, timezone, settings FROM users LIMIT 1')
			.first<{ id: string; timezone: string | null; settings: string | null }>();

		if (!user) throw error(404, 'User not found');
		const userTimezone = tzParam || user.timezone || 'UTC';

		// Cache (5 minutes)
		const rev = await getAvailabilityRevision(env.KV);
		// Include timezone so month badges update correctly when the user switches tz
		const cacheKey = `availability:month:${rev}:${eventSlug}:${month}:${userTimezone}`;
		const cached = await env.KV.get(cacheKey);
		if (cached) return json(JSON.parse(cached));

		let userSettings: { caldav?: any } = {};
		try {
			userSettings = user.settings ? JSON.parse(user.settings) : {};
		} catch {
			userSettings = {};
		}

		const eventType = await db
			.prepare('SELECT id, duration_minutes as duration, availability_calendars FROM event_types WHERE user_id = ? AND slug = ? AND is_active = 1')
			.bind(user.id, eventSlug)
			.first<{ id: string; duration: number; availability_calendars: string | null }>();

		if (!eventType) throw error(404, 'Event type not found or inactive');

		// Availability rules
		const allRules = await db
			.prepare(
				`SELECT day_of_week, start_time, end_time
				 FROM availability_rules
				 WHERE user_id = ?
				 ORDER BY day_of_week, start_time`
			)
			.bind(user.id)
			.all<{ day_of_week: number; start_time: string; end_time: string }>();

		const rulesByDay = new Map<number, Array<{ start_time: string; end_time: string }>>();
		for (const r of allRules.results || []) {
			if (!rulesByDay.has(r.day_of_week)) rulesByDay.set(r.day_of_week, []);
			rulesByDay.get(r.day_of_week)!.push({ start_time: r.start_time, end_time: r.end_time });
		}

		// Month boundaries (in user's local time, converted to UTC)
		const [year, monthNum] = month.split('-').map(Number);
		if (!year || !monthNum) throw error(400, 'Invalid month format');
		const daysInMonth = new Date(year, monthNum, 0).getDate();

		const firstDayStr = `${year}-${String(monthNum).padStart(2, '0')}-01`;
		const lastDayStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
		const monthStartUtc = createDateInTimezone(firstDayStr, '00:00', userTimezone);
		const monthEndUtc = createDateInTimezone(lastDayStr, '23:59', userTimezone);

		// Max date is 60 days from today (based on user's timezone)
		const now = new Date();
		const todayLocalStr = new Intl.DateTimeFormat('en-CA', {
			timeZone: userTimezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(now);
		// en-CA format is YYYY-MM-DD
		const todayUtc = createDateInTimezone(todayLocalStr, '00:00', userTimezone);
		const maxDateUtc = new Date(todayUtc.getTime() + 60 * 24 * 60 * 60 * 1000);

		// Busy slots (CalDAV only)
		let busySlots: TimeSlot[] = [];

		// CalDAV busy (iCloud) if configured
		const caldavEnv = {
			calendarUrl: (env as any).CALDAV_CALENDAR_URL as string | undefined,
			username: (env as any).CALDAV_USERNAME as string | undefined,
			password: (env as any).CALDAV_PASSWORD as string | undefined
		};
		const caldav = (caldavEnv.calendarUrl && caldavEnv.username && caldavEnv.password)
			? caldavEnv
			: userSettings.caldav;
		if (caldav?.calendarUrl && caldav?.username && caldav?.password) {
			try {
				const caldavBusy = await getCaldavBusyTimes(
					{ calendarUrl: caldav.calendarUrl, username: caldav.username, password: caldav.password },
					monthStartUtc,
					new Date(monthEndUtc.getTime() + 60 * 1000)
				);
				busySlots.push(...caldavBusy.map(b => ({ start: b.start.toISOString(), end: b.end.toISOString() })));
			} catch (e) {
				console.error('Error fetching CalDAV busy times (month):', e);
			}
		}

		// Existing bookings for month window
		const bookings = await db
			.prepare(
				`SELECT start_time, end_time
				 FROM bookings
				 WHERE user_id = ? AND status = 'confirmed'
				 AND start_time >= ? AND start_time <= ?
				 ORDER BY start_time`
			)
			.bind(user.id, monthStartUtc.toISOString(), monthEndUtc.toISOString())
			.all<{ start_time: string; end_time: string }>();

		const allBusySlots: TimeSlot[] = [
			...busySlots,
			...(bookings.results || []).map((b) => ({ start: b.start_time, end: b.end_time }))
		];

		const availableDates: string[] = [];
		const slotIncrement = Math.min(30, eventType.duration);

		for (let day = 1; day <= daysInMonth; day++) {
			const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

			const dayStartUtc = createDateInTimezone(dateStr, '00:00', userTimezone);
			if (dayStartUtc < todayUtc || dayStartUtc > maxDateUtc) continue;

			const dayOfWeek = getDayOfWeekInTimezone(dateStr, userTimezone);
			const rules = rulesByDay.get(dayOfWeek);
			// IMPORTANT: do NOT invent a fallback schedule.
			// If there are no rules, the day endpoint (/api/availability) will have no slots.
			// Falling back here makes the month view look like every day is available.
			const dayRules = (rules && rules.length) ? rules : [];
			if (dayRules.length === 0) continue;

			let hasAvailableSlot = false;

			for (const rule of dayRules) {
				if (hasAvailableSlot) break;
				let currentTime = createDateInTimezone(dateStr, rule.start_time, userTimezone);
				const endTime = createDateInTimezone(dateStr, rule.end_time, userTimezone);

				while (currentTime < endTime) {
					const slotEnd = new Date(currentTime);
					slotEnd.setMinutes(slotEnd.getMinutes() + eventType.duration);
					if (slotEnd > endTime) break;

					// Past check
					if (slotEnd <= now) {
						currentTime.setMinutes(currentTime.getMinutes() + slotIncrement);
						continue;
					}

					const hasConflict = allBusySlots.some((busy) => {
						const busyStart = new Date(busy.start);
						const busyEnd = new Date(busy.end);
						return (
							(currentTime >= busyStart && currentTime < busyEnd) ||
							(slotEnd > busyStart && slotEnd <= busyEnd) ||
							(currentTime <= busyStart && slotEnd >= busyEnd)
						);
					});

					if (!hasConflict) {
						hasAvailableSlot = true;
						break;
					}

					currentTime.setMinutes(currentTime.getMinutes() + slotIncrement);
				}
			}

			if (hasAvailableSlot) availableDates.push(dateStr);
		}

		await env.KV.put(cacheKey, JSON.stringify({ availableDates }), { expirationTtl: 300 });
		return json({ availableDates });
	} catch (err: any) {
		console.error('Monthly availability API error:', err);
		if (err?.status) throw err;
		throw error(500, 'Failed to fetch monthly availability');
	}
};

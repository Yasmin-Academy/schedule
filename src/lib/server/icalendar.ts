/**
 * iCalendar (.ics) availability support for Cloudflare Workers.
 *
 * Fetches one or more ICS feeds, parses VEVENTs (including simple RRULE recurrences),
 * and returns busy slots for a requested window.
 *
 * Notes:
 * - This is read-only calendar support (availability). Event creation is handled by emailing an ICS invite.
 * - Cloudflare Workers: uses fetch + pure JS parser (ical.js).
 */

import ICAL from 'ical.js';

export interface BusySlot {
	start: string; // ISO 8601 (UTC)
	end: string;   // ISO 8601 (UTC)
}

export interface CalendarEvent {
	uid?: string;
	summary?: string;
	start: string; // ISO 8601 (UTC)
	end: string;   // ISO 8601 (UTC)
	allDay?: boolean;
}

export interface IcsFeed {
	url: string;
	/**
	 * Optional label used for logging/debugging.
	 */
	name?: string;
}

/**
 * Fetch an ICS URL (public or tokenized). You can pass headers if you need.
 */
export async function fetchIcsText(url: string, init?: RequestInit): Promise<string> {
	const res = await fetch(url, {
		...init,
		// Prevent caching surprises across tenants; callers can add their own caching if desired.
		cf: { cacheTtl: 0 },
	});
	if (!res.ok) {
		const t = await res.text().catch(() => '');
		throw new Error(`ICS fetch failed (${res.status}) for ${url}: ${t}`);
	}
	return await res.text();
}

/**
 * Return busy slots from one or more ICS feeds within [windowStart, windowEnd).
 */
export async function getIcalBusyTimes(
	feeds: IcsFeed[],
	windowStart: Date,
	windowEnd: Date
): Promise<BusySlot[]> {
	if (!feeds || feeds.length === 0) return [];

	const texts = await Promise.allSettled(feeds.map(f => fetchIcsText(f.url)));
	const slots: BusySlot[] = [];

	for (let i = 0; i < texts.length; i++) {
		const r = texts[i];
		if (r.status !== 'fulfilled') {
			console.error('ICS feed fetch error:', feeds[i]?.url, r.reason);
			continue;
		}

		try {
			slots.push(...parseIcsBusySlots(r.value, windowStart, windowEnd));
		} catch (e) {
			console.error('ICS parse error:', feeds[i]?.url, e);
		}
	}

	// Normalize: sort and merge overlaps
	return mergeBusySlots(slots);
}

export function parseIcsBusySlots(
	icsText: string,
	windowStart: Date,
	windowEnd: Date
): BusySlot[] {
	const text = (icsText || '').trim();
	if (!text.includes('BEGIN:VCALENDAR')) return [];

	let vevents: any[] = [];
	let comp: any = null;
	try {
		const jcalData = ICAL.parse(text);
		comp = new ICAL.Component(jcalData);
		vevents = comp.getAllSubcomponents('vevent') ?? [];
	} catch {
		// Fallback to a defensive VEVENT parser (some CalDAV servers return malformed iCalendar)
		return parseBusySlotsFallback(text, windowStart, windowEnd);
	}

	const slots: BusySlot[] = [];

	for (const veventComp of vevents) {
		const ev = new ICAL.Event(veventComp);

		// Ignore cancelled events
		const status = (veventComp.getFirstPropertyValue('status') || '').toString().toUpperCase();
		if (status === 'CANCELLED') continue;

		// Some feeds include TRANSP:TRANSPARENT for non-blocking items
		const transp = (veventComp.getFirstPropertyValue('transp') || '').toString().toUpperCase();
		if (transp === 'TRANSPARENT') continue;

		if (ev.isRecurring()) {
			// Expand occurrences within the window.
			// IMPORTANT: start iteration near the requested window to avoid walking years of recurrences.
			let it: any;
			try {
				const startTime = ICAL.Time.fromJSDate(windowStart, true);
				it = ev.iterator(startTime);
			} catch {
				it = ev.iterator();
			}
			let next = it.next();
			// Hard stop to avoid pathological calendars
			let guard = 0;

			while (next && guard++ < 5000) {
				const occStart = next.toJSDate();
				if (occStart >= windowEnd) break;

				// Compute occurrence end from duration
				const occEnd = new Date(occStart.getTime() + ev.duration.toSeconds() * 1000);

				if (occEnd > windowStart && occStart < windowEnd) {
					slots.push({
						start: occStart.toISOString(),
						end: occEnd.toISOString()
					});
				}

				next = it.next();
			}
		} else {
			const start = ev.startDate?.toJSDate?.();
			const end = ev.endDate?.toJSDate?.();

			if (!start || !end) continue;

			// All-day events: ICAL uses date-only. We *do* treat them as busy so they block availability.

			if (end > windowStart && start < windowEnd) {
				slots.push({ start: start.toISOString(), end: end.toISOString() });
			}
		}
	}

	return slots;
}

/**
 * Parse calendar events (with basic recurrence expansion) within [windowStart, windowEnd).
 * Useful for rendering a calendar view.
 */
export function parseIcsEvents(
	icsText: string,
	windowStart: Date,
	windowEnd: Date
): CalendarEvent[] {
	const text = (icsText || '').trim();
	if (!text.includes('BEGIN:VCALENDAR')) return [];

	let vevents: any[] = [];
	try {
		const jcalData = ICAL.parse(text);
		const comp = new ICAL.Component(jcalData);
		vevents = comp.getAllSubcomponents('vevent') ?? [];
	} catch {
		return parseEventsFallback(text, windowStart, windowEnd);
	}

	const events: CalendarEvent[] = [];

	for (const veventComp of vevents) {
		const ev = new ICAL.Event(veventComp);

		const status = (veventComp.getFirstPropertyValue('status') || '').toString().toUpperCase();
		if (status === 'CANCELLED') continue;

		const transp = (veventComp.getFirstPropertyValue('transp') || '').toString().toUpperCase();
		if (transp === 'TRANSPARENT') continue;

		const summary = ev.summary || undefined;
		const uid = ev.uid || undefined;

		if (ev.isRecurring()) {
			let it: any;
			try {
				const startTime = ICAL.Time.fromJSDate(windowStart, true);
				it = ev.iterator(startTime);
			} catch {
				it = ev.iterator();
			}
			let next = it.next();
			let guard = 0;

			while (next && guard++ < 5000) {
				const occStart = next.toJSDate();
				if (occStart >= windowEnd) break;
				const occEnd = new Date(occStart.getTime() + ev.duration.toSeconds() * 1000);

				if (occEnd > windowStart && occStart < windowEnd) {
					events.push({
						uid,
						summary,
						start: occStart.toISOString(),
						end: occEnd.toISOString(),
						allDay: ev.startDate?.isDate || false
					});
				}

				next = it.next();
			}
		} else {
			const start = ev.startDate?.toJSDate();
			const end = ev.endDate?.toJSDate();
			if (!start || !end) continue;

			if (end > windowStart && start < windowEnd) {
				events.push({
					uid,
					summary,
					start: start.toISOString(),
					end: end.toISOString(),
					allDay: ev.startDate?.isDate || false
				});
			}
		}
	}

	events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
	return events;
}

function parseBusySlotsFallback(text: string, windowStart: Date, windowEnd: Date): BusySlot[] {
	const normalized = text.replace(/\r?\n/g, '\n');
	const vevents = normalized.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
	const slots: BusySlot[] = [];
	for (const block of vevents) {
		const status = block.match(/\nSTATUS[^:]*:(.+)\n/i)?.[1]?.trim()?.toUpperCase();
		if (status === 'CANCELLED') continue;
		const transp = block.match(/\nTRANSP[^:]*:(.+)\n/i)?.[1]?.trim()?.toUpperCase();
		if (transp === 'TRANSPARENT') continue;

		const dtStart = block.match(/\nDTSTART[^:]*:(.+)\n/i)?.[1]?.trim();
		const dtEnd = block.match(/\nDTEND[^:]*:(.+)\n/i)?.[1]?.trim();
		if (!dtStart || !dtEnd) continue;
		const start = parseIcsDateTime(dtStart);
		const end = parseIcsDateTime(dtEnd);
		if (!start || !end) continue;
		if (end > windowStart && start < windowEnd) {
			slots.push({ start: start.toISOString(), end: end.toISOString() });
		}
	}
	return slots;
}

function parseEventsFallback(text: string, windowStart: Date, windowEnd: Date): CalendarEvent[] {
	const normalized = text.replace(/\r?\n/g, '\n');
	const vevents = normalized.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
	const out: CalendarEvent[] = [];
	for (const block of vevents) {
		const status = block.match(/\nSTATUS[^:]*:(.+)\n/i)?.[1]?.trim()?.toUpperCase();
		if (status === 'CANCELLED') continue;
		const dtStart = block.match(/\nDTSTART[^:]*:(.+)\n/i)?.[1]?.trim();
		const dtEnd = block.match(/\nDTEND[^:]*:(.+)\n/i)?.[1]?.trim();
		if (!dtStart || !dtEnd) continue;
		const start = parseIcsDateTime(dtStart);
		const end = parseIcsDateTime(dtEnd);
		if (!start || !end) continue;
		if (!(end > windowStart && start < windowEnd)) continue;
		const uid = block.match(/\nUID[^:]*:(.+)\n/i)?.[1]?.trim() || crypto.randomUUID();
		const summary = block.match(/\nSUMMARY[^:]*:(.+)\n/i)?.[1]?.trim() || '(No title)';
		out.push({
			uid,
			summary,
			start: start.toISOString(),
			end: end.toISOString(),
			allDay: /^\d{8}$/.test(dtStart)
		});
	}
	return out;
}

function parseIcsDateTime(value: string): Date | null {
	const v = value.trim();
	if (!v) return null;
	// All-day
	if (/^\d{8}$/.test(v)) {
		const y = Number(v.slice(0, 4));
		const m = Number(v.slice(4, 6));
		const d = Number(v.slice(6, 8));
		if (!y || !m || !d) return null;
		return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
	}
	const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const hour = Number(m[4]);
	const minute = Number(m[5]);
	const second = Number(m[6]);
	if (!year || !month || !day) return null;
	// Floating times are ambiguous without TZID; treat as UTC.
	return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * Helper for other integrations (e.g., CalDAV) that want busy times as Date objects.
 */
export function parseICalendarToBusyTimes(
	icsText: string,
	windowStart: Date,
	windowEnd: Date
): Array<{ start: Date; end: Date }> {
	const slots = parseIcsBusySlots(icsText, windowStart, windowEnd);
	return slots.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
}

function mergeBusySlots(slots: BusySlot[]): BusySlot[] {
	if (slots.length <= 1) return slots;

	const sorted = [...slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
	const merged: BusySlot[] = [];

	for (const s of sorted) {
		const last = merged[merged.length - 1];
		if (!last) {
			merged.push({ ...s });
			continue;
		}

		if (Date.parse(s.start) <= Date.parse(last.end)) {
			// overlap or touch
			if (Date.parse(s.end) > Date.parse(last.end)) {
				last.end = s.end;
			}
		} else {
			merged.push({ ...s });
		}
	}

	return merged;
}

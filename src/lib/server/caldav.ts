import { parseICalendarToBusyTimes, parseIcsEvents, type CalendarEvent } from '$lib/server/icalendar';

export type CaldavConfig = {
	calendarUrl: string; // full calendar collection URL
	username: string;
	password: string; // app-specific password recommended
};

function basicAuth(username: string, password: string) {
	const token = btoa(`${username}:${password}`);
	return `Basic ${token}`;
}

/**
 * CalDAV REPORT (calendar-query) to fetch events in a time range.
 * We request calendar-data and then reuse our iCal parser.
 */
export async function getCaldavBusyTimes(
	config: CaldavConfig,
	startUtc: Date,
	endUtc: Date
): Promise<Array<{ start: Date; end: Date }>> {
	const start = startUtc.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
	const end = endUtc.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

	const body = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:prop>
		<d:getetag />
		<c:calendar-data />
	</d:prop>
	<c:filter>
		<c:comp-filter name="VCALENDAR">
			<c:comp-filter name="VEVENT">
				<c:time-range start="${start}" end="${end}" />
			</c:comp-filter>
		</c:comp-filter>
	</c:filter>
</c:calendar-query>`;

	const res = await fetch(config.calendarUrl, {
		method: 'REPORT',
		headers: {
			'Authorization': basicAuth(config.username, config.password),
			'Depth': '1',
			'Content-Type': 'application/xml; charset=utf-8'
		},
		body
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`CalDAV REPORT failed: ${res.status} ${res.statusText}${text ? `\n${text.slice(0, 500)}` : ''}`);
	}

	const xml = await res.text();
	// Very small XML extraction (we only need calendar-data blocks).
	const calendarDataBlocks: string[] = [];
	const re = /<[^:>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*:?calendar-data>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		// Unescape XML entities that commonly appear inside calendar-data.
		const raw = (m[1] ?? '')
			.trim()
			.replace(/^<!\[CDATA\[/, '')
			.replace(/\]\]>$/, '')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#13;/g, '\r')
			.replace(/&amp;/g, '&');
		if (raw.includes('BEGIN:VCALENDAR')) calendarDataBlocks.push(raw);
	}

	const busy: Array<{ start: Date; end: Date }> = [];
	for (const ics of calendarDataBlocks) {
		try {
			busy.push(...parseICalendarToBusyTimes(ics, startUtc, endUtc));
		} catch (err) {
			// Some providers return malformed calendar-data for certain resources.
			// Skip bad blocks so one broken resource doesn't break availability for everything.
			console.error('Skipping malformed CalDAV calendar-data block while computing busy times', err);
		}
	}
	return busy;
}

/**
 * Fetch and parse VEVENTs from CalDAV within a time window.
 * This is used for the dashboard calendar view.
 */
export async function getCaldavEvents(
	config: CaldavConfig,
	startUtc: Date,
	endUtc: Date
): Promise<CalendarEvent[]> {
	const start = startUtc.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
	const end = endUtc.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

	const body = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:prop>
		<d:getetag />
		<c:calendar-data />
	</d:prop>
	<c:filter>
		<c:comp-filter name="VCALENDAR">
			<c:comp-filter name="VEVENT">
				<c:time-range start="${start}" end="${end}" />
			</c:comp-filter>
		</c:comp-filter>
	</c:filter>
</c:calendar-query>`;

	const res = await fetch(config.calendarUrl, {
		method: 'REPORT',
		headers: {
			Authorization: basicAuth(config.username, config.password),
			Depth: '1',
			'Content-Type': 'application/xml; charset=utf-8'
		},
		body
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(
			`CalDAV REPORT failed: ${res.status} ${res.statusText}${text ? `\n${text.slice(0, 500)}` : ''}`
		);
	}

	const xml = await res.text();
	const calendarDataBlocks: string[] = [];
	const re = /<[^:>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*:?calendar-data>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		const raw = m[1]
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#13;/g, '\r')
			.replace(/&amp;/g, '&');
		calendarDataBlocks.push(raw);
	}

	const events: CalendarEvent[] = [];
	for (const ics of calendarDataBlocks) {
		events.push(...parseIcsEvents(ics, startUtc, endUtc));
	}
	return events;
}

function formatICSDateUtc(date: Date): string {
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildBlockingEventICS(params: {
	uid: string;
	startUtc: Date;
	endUtc: Date;
	summary: string;
}): string {
	const dtstamp = formatICSDateUtc(new Date());
	const dtstart = formatICSDateUtc(params.startUtc);
	const dtend = formatICSDateUtc(params.endUtc);
	const safeSummary = params.summary.replace(/\r?\n/g, ' ');

	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//CloudMeet//EN',
		'CALSCALE:GREGORIAN',
		'BEGIN:VEVENT',
		`UID:${params.uid}`,
		`DTSTAMP:${dtstamp}`,
		`DTSTART:${dtstart}`,
		`DTEND:${dtend}`,
		`SUMMARY:${safeSummary}`,
		'TRANSP:OPAQUE',
		'END:VEVENT',
		'END:VCALENDAR',
		''
	].join('\r\n');
}

/**
 * Create / update bookings on a CalDAV calendar by uploading a VEVENT.
 * We PUT to a resource URL under the calendar collection.
 */
export async function upsertCaldavEvent(
	config: CaldavConfig,
	resourceName: string,
	icsBody: string
): Promise<string> {
	const url = config.calendarUrl.replace(/\/+$/, '/') + resourceName.replace(/^\/+/, '');
	const res = await fetch(url, {
		method: 'PUT',
		headers: {
			'Authorization': basicAuth(config.username, config.password),
			'Content-Type': 'text/calendar; charset=utf-8'
		},
		body: icsBody
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`CalDAV PUT failed: ${res.status} ${res.statusText}${text ? `\n${text.slice(0, 500)}` : ''}`);
	}
	return url;
}

export async function deleteCaldavEvent(config: CaldavConfig, eventUrl: string): Promise<void> {
	const res = await fetch(eventUrl, {
		method: 'DELETE',
		headers: {
			Authorization: basicAuth(config.username, config.password)
		}
	});
	if (!res.ok && res.status !== 404) {
		const text = await res.text().catch(() => '');
		throw new Error(`CalDAV DELETE failed: ${res.status} ${res.statusText}${text ? `\n${text.slice(0, 500)}` : ''}`);
	}
}


// -------- iCloud CalDAV discovery (no manual URL required) --------

type DiscoveredCalendar = { name: string; url: string };

/**
 * Discover the user's CalDAV calendar-home-set and list available calendars.
 * Works with iCloud. Uses standard WebDAV/CalDAV discovery:
 * 1) PROPFIND / -> current-user-principal
 * 2) PROPFIND principal -> calendar-home-set
 * 3) PROPFIND home-set (Depth: 1) -> calendars (displayname + href)
 */
export async function discoverIcloudCalendars(
	username: string,
	password: string
): Promise<{ calendars: DiscoveredCalendar[]; defaultUrl?: string }> {
	const auth = basicAuth(username, password);

	async function propfind(url: string, depth: '0' | '1', body: string) {
		const res = await fetch(url, {
			method: 'PROPFIND',
			headers: {
				Authorization: auth,
				Depth: depth,
				'Content-Type': 'application/xml; charset=utf-8'
			},
			body
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`CalDAV PROPFIND failed (${res.status}). ${text}`.slice(0, 400));
		}
		return text;
	}

	function firstHref(xml: string, tag: string): string | undefined {
		// matches <tag> (optionally namespaced like <d:tag>) ... <href>VALUE</href> ... </tag>
		const re = new RegExp(
			`<(?:\\w+:)?${tag}[^>]*>[\\s\\S]*?<[^>]*href[^>]*>([^<]+)<\\/[^>]*href>[\\s\\S]*?<\\/(?:\\w+:)?${tag}>`,
			'i'
		);
		const m = xml.match(re);
		return m?.[1];
	}

	function decodeHref(href: string) {
		// hrefs from iCloud are path-only; normalize to absolute
		if (href.startsWith('http')) return href;
		return `https://caldav.icloud.com${href}`;
	}

	// 1) current-user-principal
	const rootBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`;
	const rootXml = await propfind('https://caldav.icloud.com/', '0', rootBody);
	const principalHref = firstHref(rootXml, 'current-user-principal');
	if (!principalHref) throw new Error('Could not find current-user-principal (iCloud discovery).');

	// 2) calendar-home-set
	const principalUrl = decodeHref(principalHref);
	const principalBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <cal:calendar-home-set/>
    <cs:calendar-home-set/>
  </d:prop>
</d:propfind>`;
	const principalXml = await propfind(principalUrl, '0', principalBody);

	let homeHref =
		firstHref(principalXml, 'calendar-home-set') ||
		firstHref(principalXml, 'cs:calendar-home-set') ||
		firstHref(principalXml, 'calendar-home-set/');

	// Fallback: iCloud usually returns <calendar-home-set><href>...</href>
	if (!homeHref) {
		// try a looser search
		const m = principalXml.match(/calendar-home-set[\s\S]*?<href[^>]*>([^<]+)<\/href>/i);
		homeHref = m?.[1];
	}
	if (!homeHref) throw new Error('Could not find calendar-home-set (iCloud discovery).');

	const homeUrl = decodeHref(homeHref);

	// 3) list calendars under home-set
	const homeBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;
	const homeXml = await propfind(homeUrl, '1', homeBody);

	// Parse <response> blocks and select ones that are calendars
	const responses = homeXml.split(/<response[^>]*>/i).slice(1).map((s) => '<response>' + s);
	const calendars: DiscoveredCalendar[] = [];
	for (const r of responses) {
		const hrefMatch = r.match(/<href[^>]*>([^<]+)<\/href>/i);
		if (!hrefMatch) continue;
		const href = hrefMatch[1];

		// Must contain <resourcetype> with <calendar/> (often namespaced like <cal:calendar/>)
		// Be permissive: some servers emit different prefixes.
		const isCal = /<resourcetype[\s\S]*?<(?:\w+:)?calendar\b[\s\S]*?>/i.test(r);
		if (!isCal) continue;

		const nameMatch = r.match(/<displayname[^>]*>([\s\S]*?)<\/displayname>/i);
		const name = (nameMatch?.[1] ?? 'Calendar').replace(/\s+/g, ' ').trim();

		calendars.push({ name, url: decodeHref(href) });
	}

	// Some CalDAV servers (notably iCloud for some accounts) can return an empty
	// calendar-home listing even when calendars exist. Fallback: enumerate hrefs
	// and probe each candidate collection individually.
	if (calendars.length === 0) {
		// Fallback strategy:
		// 1) Extract child hrefs from the Depth:1 response we already have.
		// 2) Probe likely calendar collections with a Depth:0 PROPFIND.
		const hrefs = Array.from(homeXml.matchAll(/<href[^>]*>([^<]+)<\/href>/gi)).map((m) => decodeHref(m[1]));
		const candidates = hrefs
			.filter((h) => h && h !== homeUrl)
			.filter((h) => /\/calendars\//.test(h))
			.slice(0, 30);

		const probeBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

		for (const cand of candidates) {
			try {
				const probeXml = await propfind(cand, '0', probeBody);
				const isCal = /<resourcetype[\s\S]*?<(?:\w+:)?calendar\b[\s\S]*?>/i.test(probeXml);
				if (!isCal) continue;
				const nameMatch = probeXml.match(/<displayname[^>]*>([\s\S]*?)<\/displayname>/i);
				const name = (nameMatch?.[1] ?? 'Calendar').replace(/\s+/g, ' ').trim();
				calendars.push({ name, url: cand });
			} catch {
				// ignore
			}
		}
	}

	// Choose a default calendar: try one named "Home", else first
	let defaultUrl = calendars.find((c) => /^home$/i.test(c.name))?.url ?? calendars[0]?.url;

	return { calendars, defaultUrl };
}

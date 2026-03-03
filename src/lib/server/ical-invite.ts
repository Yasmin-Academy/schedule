/**
 * Generate an iCalendar (.ics) invite payload suitable for emailing.
 * Works without talking to Google/Outlook APIs.
 *
 * References:
 * - RFC 5545 (iCalendar)
 * - RFC 5546 (iTIP scheduling)
 *
 * This generator intentionally keeps things simple and widely compatible.
 */

export interface IcsInviteInput {
	uid: string;
	summary: string;
	description?: string;
	location?: string;
	startUtc: Date;
	endUtc: Date;
	organizerName: string;
	organizerEmail: string;
	attendeeName: string;
	attendeeEmail: string;
	/**
	 * Optional URL shown to attendees (e.g., Zoom link). If provided, will be placed in DESCRIPTION.
	 */
	url?: string;
	/**
	 * For updates/cancellations (optional).
	 */
	method?: 'REQUEST' | 'CANCEL';
	sequence?: number;
}

function pad2(n: number) {
	return n < 10 ? `0${n}` : `${n}`;
}

function formatUtc(dt: Date): string {
	// YYYYMMDDTHHMMSSZ
	return (
		dt.getUTCFullYear().toString() +
		pad2(dt.getUTCMonth() + 1) +
		pad2(dt.getUTCDate()) +
		'T' +
		pad2(dt.getUTCHours()) +
		pad2(dt.getUTCMinutes()) +
		pad2(dt.getUTCSeconds()) +
		'Z'
	);
}

function escapeText(s: string): string {
	// iCal text escaping: backslash, comma, semicolon, newline
	return s
		.replace(/\\/g, '\\\\')
		.replace(/,/g, '\\,')
		.replace(/;/g, '\\;')
		.replace(/\r?\n/g, '\\n');
}

export function generateIcsInvite(input: IcsInviteInput): string {
	const now = new Date();
	const method = input.method ?? 'REQUEST';
	const sequence = input.sequence ?? 0;

	let description = input.description ?? '';
	if (input.url) {
		description = description ? `${description}\n\n${input.url}` : input.url;
	}

	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'PRODID:-//Scheduler//EN',
		'VERSION:2.0',
		'CALSCALE:GREGORIAN',
		`METHOD:${method}`,
		'BEGIN:VEVENT',
		`UID:${escapeText(input.uid)}`,
		`DTSTAMP:${formatUtc(now)}`,
		`DTSTART:${formatUtc(input.startUtc)}`,
		`DTEND:${formatUtc(input.endUtc)}`,
		`SUMMARY:${escapeText(input.summary)}`,
		`DESCRIPTION:${escapeText(description)}`,
		input.location ? `LOCATION:${escapeText(input.location)}` : '',
		`ORGANIZER;CN=${escapeText(input.organizerName)}:mailto:${escapeText(input.organizerEmail)}`,
		`ATTENDEE;CN=${escapeText(input.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${escapeText(input.attendeeEmail)}`,
		`SEQUENCE:${sequence}`,
		'STATUS:CONFIRMED',
		'TRANSP:OPAQUE',
		'END:VEVENT',
		'END:VCALENDAR'
	].filter(Boolean);

	// Fold lines at 75 octets is the spec; most clients tolerate unfurled lines.
	// We'll keep as-is for simplicity.
	return lines.join('\r\n') + '\r\n';
}

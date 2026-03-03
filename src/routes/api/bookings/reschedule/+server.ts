/**
import { bumpAvailabilityRevision } from '$lib/server/availability-revision';
 * Reschedule Booking API endpoint
 *
 * Google/Outlook integrations removed.
 * This endpoint updates the booking in DB and emails an updated iCalendar (.ics) invite.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateIcsInvite } from '$lib/server/ical-invite';
import { sendRescheduleEmail, sendAdminRescheduleNotification, getEmailTemplates, isEmailEnabled } from '$lib/server/email';
import { upsertCaldavEvent } from '$lib/server/caldav';

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform?.env;
	if (!env) throw error(500, 'Platform env not available');
	const db = env.DB;

	const body = (await request.json()) as {
		bookingId: string;
		newStartTime: string;
		newEndTime: string;
		timezone?: string;
	};

	const { bookingId, newStartTime, newEndTime, timezone } = body;
	if (!bookingId || !newStartTime || !newEndTime) throw error(400, 'Missing required fields');

	const original = await db
		.prepare(
			`SELECT b.id, b.user_id, b.event_type_id, b.start_time, b.end_time,
			b.attendee_name, b.attendee_email, b.attendee_notes, b.meeting_url,
			e.name as event_name, e.slug as event_slug, e.description as event_description, e.location_details,
			u.name as host_name, u.email as host_email, u.contact_email, u.settings, u.brand_color
			FROM bookings b
			JOIN event_types e ON b.event_type_id = e.id
			JOIN users u ON b.user_id = u.id
			WHERE b.id = ?`
		)
		.bind(bookingId)
		.first<{
			id: string;
			user_id: string;
			event_type_id: string;
			start_time: string;
			end_time: string;
			attendee_name: string;
			attendee_email: string;
			attendee_notes: string | null;
			meeting_url: string | null;
			event_name: string;
			event_slug: string;
			event_description: string | null;
			location_details: string | null;
			host_name: string;
			host_email: string;
			contact_email: string | null;
			settings: string | null;
			brand_color: string | null;
		}>();

	if (!original) throw error(404, 'Booking not found');

	const newStart = new Date(newStartTime);
	const newEnd = new Date(newEndTime);
	if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime())) throw error(400, 'Invalid date');
	if (newEnd <= newStart) throw error(400, 'End time must be after start time');

	// Conflict check (host bookings)
	const conflict = await db
		.prepare(
			`SELECT id FROM bookings
			WHERE user_id = ? AND status = 'confirmed' AND id != ?
			AND (
				(start_time <= ? AND end_time > ?)
				OR (start_time < ? AND end_time >= ?)
				OR (start_time >= ? AND end_time <= ?)
			)`
		)
		.bind(original.user_id, bookingId, newStartTime, newStartTime, newEndTime, newEndTime, newStartTime, newEndTime)
		.first();

	if (conflict) throw error(409, 'This time slot is no longer available');

	await db
		.prepare('UPDATE bookings SET start_time = ?, end_time = ?, status = ? WHERE id = ?')
		.bind(newStartTime, newEndTime, 'rescheduled', bookingId)
		.run();

	// CalDAV: update event if configured (two-way sync)
	try {
		let settings: any = {};
		try {
			settings = original.settings ? JSON.parse(original.settings) : {};
		} catch {
			settings = {};
		}
		const caldavEnv = {
			calendarUrl: (env as any).CALDAV_CALENDAR_URL as string | undefined,
			username: (env as any).CALDAV_USERNAME as string | undefined,
			password: (env as any).CALDAV_PASSWORD as string | undefined
		};
		const caldav = (caldavEnv.calendarUrl && caldavEnv.username && caldavEnv.password)
			? caldavEnv
			: settings.caldav;
		if (caldav?.calendarUrl && caldav?.username && caldav?.password) {
			const meetingUrl = original.meeting_url || original.location_details || null;
			const caldavIcs = generateIcsInvite({
				uid: bookingId,
				summary: `${original.event_name} with ${original.attendee_name}`,
				description: `${original.event_description || ''}\n\nAttendee: ${original.attendee_name} (${original.attendee_email})${original.attendee_notes ? `\n\nNotes from attendee:\n${original.attendee_notes}` : ''}`,
				location: original.location_details || undefined,
				url: meetingUrl || undefined,
				startUtc: newStart,
				endUtc: newEnd,
				organizerName: original.host_name,
				organizerEmail: original.contact_email || original.host_email,
				attendeeName: original.attendee_name,
				attendeeEmail: original.attendee_email,
				method: 'REQUEST',
				sequence: 1
			});
			const eventUrl = await upsertCaldavEvent(
				{ calendarUrl: caldav.calendarUrl, username: caldav.username, password: caldav.password },
				`${bookingId}.ics`,
				caldavIcs
			);
			await db.prepare('UPDATE bookings SET caldav_event_url = ?, caldav_uid = ? WHERE id = ?').bind(eventUrl, bookingId, bookingId).run();
		}
	} catch (e) {
		console.error('CalDAV sync error (reschedule):', e);
	}

	// Email notifications (optional)
	if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN && env.MAILGUN_FROM) {
		let timeFormat: '12h' | '24h' = '12h';
		try {
			const settings = original.settings ? JSON.parse(original.settings) : {};
			timeFormat = settings.timeFormat === '24h' ? '24h' : '12h';
		} catch {}

		const replyToEmail = original.contact_email || original.host_email;
		const templates = await getEmailTemplates(db, original.user_id);

		const meetingUrl = original.meeting_url || original.location_details || null;
		const inviteIcs = generateIcsInvite({
			uid: bookingId,
			summary: `${original.event_name} with ${original.host_name}`,
			description: original.event_description || '',
			location: original.location_details || undefined,
			startUtc: newStart,
			endUtc: newEnd,
			organizerName: original.host_name,
			organizerEmail: replyToEmail,
			attendeeName: original.attendee_name,
			attendeeEmail: original.attendee_email,
			url: meetingUrl || undefined,
			method: 'REQUEST',
			sequence: 1
		});
		const attachments = [{ filename: 'updated-invite.ics', contentType: 'text/calendar; charset=utf-8; method=REQUEST', data: inviteIcs }];

		if (isEmailEnabled(templates, 'reschedule')) {
			await sendRescheduleEmail(
				{
					attendeeName: original.attendee_name,
					attendeeEmail: original.attendee_email,
					eventName: original.event_name,
					eventSlug: original.event_slug,
					eventDescription: original.event_description || '',
					startTime: newStart,
					endTime: newEnd,
					oldStartTime: new Date(original.start_time),
					oldEndTime: new Date(original.end_time),
					meetingUrl,
					bookingId,
					hostName: original.host_name,
					hostEmail: original.host_email,
					hostContactEmail: original.contact_email || undefined,
					appUrl: env.APP_URL || '',
					timeFormat,
					timezone: timezone || 'UTC',
					brandColor: original.brand_color || undefined,
					attendeeNotes: original.attendee_notes
				},
				{
					apiKey: env.MAILGUN_API_KEY,
				apiBase: (env as any).MAILGUN_API_BASE,
					domain: env.MAILGUN_DOMAIN,
					from: env.MAILGUN_FROM,
					replyTo: env.MAILGUN_REPLY_TO || replyToEmail
				},
				undefined,
				attachments
			);
		}

		try {
			await sendAdminRescheduleNotification(
				{
					attendeeName: original.attendee_name,
					attendeeEmail: original.attendee_email,
					eventName: original.event_name,
					eventSlug: original.event_slug,
					eventDescription: original.event_description || '',
					startTime: newStart,
					endTime: newEnd,
					oldStartTime: new Date(original.start_time),
					oldEndTime: new Date(original.end_time),
					meetingUrl,
					bookingId,
					hostName: original.host_name,
					hostEmail: original.host_email,
					appUrl: env.APP_URL || '',
					timeFormat,
					brandColor: original.brand_color || undefined
				},
				original.host_email,
				{
					apiKey: env.MAILGUN_API_KEY,
				apiBase: (env as any).MAILGUN_API_BASE,
					domain: env.MAILGUN_DOMAIN,
					from: env.MAILGUN_FROM,
					replyTo: env.MAILGUN_REPLY_TO || replyToEmail
				},
				attachments
			);
		} catch (e) {
			console.error('Failed to send admin reschedule notification:', e);
		}
	}

	// Invalidate all cached availability immediately
		await bumpAvailabilityRevision(env.KV);

		return json({ success: true });
};

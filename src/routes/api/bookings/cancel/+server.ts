/**
import { bumpAvailabilityRevision } from '$lib/server/availability-revision';
 * Cancel Booking API endpoint
 * Cancels a booking and sends notification to attendee with optional message
 */

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { getCurrentUser } from '$lib/server/auth';
import { sendCancellationEmail, getEmailTemplates, isEmailEnabled } from '$lib/server/email';
import { deleteCaldavEvent } from '$lib/server/caldav';

export const POST = async (event: RequestEvent) => {
	const env = event.platform?.env;
	if (!env) {
		throw error(500, 'Platform env not available');
	}

	const db = env.DB;

	// Get current user
	const userId = await getCurrentUser(event);
	if (!userId) {
		throw error(401, 'Unauthorized');
	}

	try {
		const body = await event.request.json() as {
			bookingId: string;
			message?: string | null;
		};
		const { bookingId, message } = body;

		if (!bookingId) {
			throw error(400, 'Booking ID is required');
		}

		// Get booking and verify ownership
		const booking = await db
			.prepare(
				`SELECT b.id, b.user_id, b.google_event_id, b.outlook_event_id, b.caldav_event_url, b.caldav_uid, b.status, b.start_time, b.end_time,
				b.attendee_name, b.attendee_email,
				e.name as event_name, e.slug as event_slug, e.description as event_description,
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
				google_event_id: string | null;
				outlook_event_id: string | null;
				caldav_event_url: string | null;
				caldav_uid: string | null;
				status: string;
				start_time: string;
				end_time: string;
				attendee_name: string;
				attendee_email: string;
				event_name: string;
				event_slug: string;
				event_description: string | null;
				host_name: string;
				host_email: string;
				contact_email: string | null;
				settings: string | null;
				brand_color: string | null;
			}>();

		if (!booking) {
			throw error(404, 'Booking not found');
		}

		if (booking.user_id !== userId) {
			throw error(403, 'You do not have permission to cancel this booking');
		}

		if (booking.status === 'canceled') {
			throw error(400, 'Booking is already canceled');
		}

		// CalDAV: delete corresponding event if present
		try {
			let settings: any = {};
			try {
				settings = booking.settings ? JSON.parse(booking.settings) : {};
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
			if (caldav?.username && caldav?.password && booking.caldav_event_url) {
				await deleteCaldavEvent(
					{ calendarUrl: caldav.calendarUrl, username: caldav.username, password: caldav.password },
					booking.caldav_event_url
				);
			}
		} catch (e) {
			console.error('CalDAV sync error (cancel booking):', e);
		}

		// Google/Outlook integrations removed. No external event to cancel.

		// Update booking status
		await db
			.prepare('UPDATE bookings SET status = ?, canceled_at = CURRENT_TIMESTAMP, canceled_by = ?, cancellation_reason = ? WHERE id = ?')
			.bind('canceled', 'host', message || null, bookingId)
			.run();

		// Cancel any scheduled reminder emails
		await db
			.prepare(`UPDATE scheduled_emails SET status = 'cancelled' WHERE booking_id = ? AND status = 'pending'`)
			.bind(bookingId)
			.run();

		// Send cancellation email if enabled
		if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN && env.MAILGUN_FROM) {
			try {
				// Parse user settings for time format
				let timeFormat: '12h' | '24h' = '12h';
				try {
					const settings = booking.settings ? JSON.parse(booking.settings) : {};
					timeFormat = settings.timeFormat === '24h' ? '24h' : '12h';
				} catch {
					// Keep default
				}

				const replyToEmail = booking.contact_email || booking.host_email;
				const templates = await getEmailTemplates(db, booking.user_id);

				if (isEmailEnabled(templates, 'cancellation')) {
					const template = templates.get('cancellation');
					await sendCancellationEmail(
						{
							attendeeName: booking.attendee_name,
							attendeeEmail: booking.attendee_email,
							eventName: booking.event_name,
							eventSlug: booking.event_slug,
							eventDescription: booking.event_description || '',
							startTime: new Date(booking.start_time),
							endTime: new Date(booking.end_time),
							meetingUrl: null,
							bookingId: booking.id,
							hostName: booking.host_name,
							hostEmail: booking.host_email,
							hostContactEmail: booking.contact_email || undefined,
							appUrl: env.APP_URL || '',
							customMessage: message || template?.custom_message || null,
							timeFormat,
							brandColor: booking.brand_color || undefined
						},
						{
							apiKey: env.MAILGUN_API_KEY,
						apiBase: (env as any).MAILGUN_API_BASE,
							domain: env.MAILGUN_DOMAIN,
							from: env.MAILGUN_FROM,
							replyTo: env.MAILGUN_REPLY_TO || replyToEmail
						},
						template?.subject || undefined
					);
				}

				// No admin notification needed - admin is the one cancelling from dashboard
			} catch (emailErr) {
				console.error('Failed to send cancellation email:', emailErr);
				// Don't fail the request if email fails
			}
		}

		// Invalidate all cached availability immediately
		await bumpAvailabilityRevision(env.KV);

		return json({ success: true });
	} catch (err: any) {
		console.error('Cancel booking error:', err);
		if (err?.status) throw err;
		throw error(500, 'Failed to cancel booking');
	}
};

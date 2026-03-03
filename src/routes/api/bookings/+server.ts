/**
 * Bookings API endpoint
 * Creates new bookings and emails an iCalendar (.ics) invite attachment.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendBookingEmail, sendAdminNotificationEmail, getEmailTemplates, isEmailEnabled, type EmailTemplateType } from '$lib/server/email';
import { isValidEmail, validateLength, validateFields, MAX_LENGTHS } from '$lib/server/validation';
import { generateIcsInvite } from '$lib/server/ical-invite';
import { upsertCaldavEvent } from '$lib/server/caldav';

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform?.env;
	if (!env) {
		throw error(500, 'Platform env not available');
	}

	// Basic abuse protection for the public booking endpoint.
	// This is intentionally lightweight (low usage) and meant to be paired with
	// Cloudflare WAF rate limiting rules.
	const allowedOrigins = (env.WIDGET_ALLOWED_ORIGINS || '')
		.split(',')
		.map((s: string) => s.trim())
		.filter(Boolean);

	const origin = request.headers.get('Origin');
	const referer = request.headers.get('Referer');
	const isAllowedOrigin = (() => {
		if (allowedOrigins.length === 0) return true; // allow by default if not configured
		if (origin) return allowedOrigins.includes(origin);
		if (referer) return allowedOrigins.some((o) => referer === o || referer.startsWith(o + '/'));
		return false;
	})();

	// If the request is coming cross-origin, enforce allowlist.
	// We still allow same-origin requests (no Origin header) when allowlist is empty.
	if (!isAllowedOrigin) {
		throw error(403, 'Forbidden');
	}

	try {
		const body = await request.json() as {
			eventSlug: string;
			startTime: string;
			endTime: string;
			attendeeName: string;
			attendeeEmail: string;
			notes?: string;
			// honeypot - should always be empty for humans
			company_website?: string;
			// client-side start time used for a minimum time-to-submit check
			client_started_at?: number;
			turnstileToken?: string;
			timezone?: string;
			lang?: 'en' | 'ar';
		};
		const { eventSlug, startTime, endTime, attendeeName, attendeeEmail, notes, turnstileToken, timezone } = body;
		const lang = body.lang === 'ar' ? 'ar' : 'en';

		// Honeypot: bots often fill hidden fields.
		if (body.company_website && String(body.company_website).trim() !== '') {
			throw error(400, 'Bad request');
		}

		// Minimum time-to-submit: blocks very naive bots that POST immediately.
		// This is not cryptographically strong; the primary protection should be WAF rate limiting.
		if (typeof body.client_started_at === 'number') {
			const elapsedMs = Date.now() - body.client_started_at;
			if (!Number.isFinite(elapsedMs) || elapsedMs < 1500) {
				throw error(429, 'Please try again');
			}
		}

		// Validate required fields
		if (!eventSlug || !startTime || !endTime || !attendeeName || !attendeeEmail) {
			throw error(400, 'Missing required fields');
		}

		// Validate input lengths
		const lengthError = validateFields([
			validateLength(attendeeName, 'Name', MAX_LENGTHS.name, true),
			validateLength(attendeeEmail, 'Email', MAX_LENGTHS.email, true),
			validateLength(notes, 'Notes', MAX_LENGTHS.notes, false)
		]);
		if (lengthError) {
			throw error(400, lengthError);
		}

		// Validate email format
		if (!isValidEmail(attendeeEmail)) {
			throw error(400, 'Invalid email address');
		}

		// Verify Turnstile token (if provided)
		if (turnstileToken) {
			const turnstileResponse = await fetch(
				'https://challenges.cloudflare.com/turnstile/v0/siteverify',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						secret: env.TURNSTILE_SECRET_KEY || '',
						response: turnstileToken
					})
				}
			);

			const turnstileResult = await turnstileResponse.json() as { success: boolean };
			if (!turnstileResult.success) {
				throw error(400, 'Turnstile verification failed');
			}
		}

		const db = env.DB;

		// Get the first (and only) user for single-user setup
		const user = await db
			.prepare('SELECT id, email, name, slug, contact_email, settings, brand_color, outlook_refresh_token FROM users LIMIT 1')
			.first<{ id: string; email: string; name: string; slug: string; contact_email: string | null; settings: string | null; brand_color: string | null; outlook_refresh_token: string | null }>();

		if (!user) {
			throw error(404, 'User not found');
		}

		const eventType = await db
			.prepare('SELECT id, name, duration_minutes as duration, description, location_details FROM event_types WHERE user_id = ? AND slug = ? AND is_active = 1')
			.bind(user.id, eventSlug)
			.first<{ id: string; name: string; duration: number; description: string; location_details: string | null }>();

		if (!eventType) {
			throw error(404, 'Event type not found or inactive');
		}

		// Google/Outlook integrations removed.
		// Calendar invitations are sent via email as an iCalendar (.ics) attachment.

		// Verify slot is still available
		const startDateTime = new Date(startTime);
		const endDateTime = new Date(endTime);

		// Check for conflicts with existing bookings
		const conflict = await db
			.prepare(
				`SELECT id FROM bookings
				WHERE user_id = ? AND status = 'confirmed'
				AND (
					(start_time <= ? AND end_time > ?)
					OR (start_time < ? AND end_time >= ?)
					OR (start_time >= ? AND end_time <= ?)
				)`
			)
			.bind(user.id, startTime, startTime, endTime, endTime, startTime, endTime)
			.first();

		if (conflict) {
			throw error(409, 'This time slot is no longer available');
		}

		// Create a booking id up-front so we can reference it consistently (DB + meeting URL + CalDAV UID)
		const bookingId = crypto.randomUUID();

		// Online room link is hosted on the main domain (not the embed subdomain).
		const appBase = (env.MAIN_DOMAIN || env.APP_URL).replace(/\/$/, '');
		const meetingUrl: string = `${appBase}/${lang}/consultation/room?id=${bookingId}`;

		// If CalDAV is connected, prevent double-booking by checking for a conflict right before insert.
		try {
			let settings: any = {};
			try {
				settings = user.settings ? JSON.parse(user.settings) : {};
			} catch {
				settings = {};
			}
			const caldav = settings.caldav;
			if (caldav?.calendarUrl && caldav?.username && caldav?.password) {
				const { getCaldavBusyTimes } = await import('$lib/server/caldav');
				const windowStart = new Date(startDateTime.getTime() - 24 * 60 * 60 * 1000);
				const windowEnd = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
				const busy = await getCaldavBusyTimes(
					{ calendarUrl: caldav.calendarUrl, username: caldav.username, password: caldav.password },
					windowStart,
					windowEnd
				);
				const conflict = busy.some((b) => {
					const bs = new Date(b.start);
					const be = new Date(b.end);
					return bs < endDateTime && be > startDateTime;
				});
				if (conflict) {
					return json({ success: false, error: 'This time slot is no longer available' }, { status: 409 });
				}
			}
		} catch (e) {
			// If conflict check fails, proceed (availability endpoint should have blocked it).
			console.error('CalDAV conflict check failed:', e);
		}

		// Create booking in database
		const result = await db
			.prepare(
				`INSERT INTO bookings (
					id, user_id, event_type_id, start_time, end_time,
					attendee_name, attendee_email, attendee_notes, status,
					google_event_id, outlook_event_id, meeting_url, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NULL, NULL, ?, CURRENT_TIMESTAMP)`
			)
			.bind(
				bookingId,
				user.id,
				eventType.id,
				startTime,
				endTime,
				attendeeName,
				attendeeEmail,
				notes || null,
				meetingUrl
			)
			.run();

		// Invalidate all cached availability immediately
		await bumpAvailabilityRevision(env.KV);

		let attendeeEmailSent = false;
		let adminEmailSent = false;
		let emailSendError: string | undefined;

		if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN && env.MAILGUN_FROM) {
			try {
				// Parse user settings for time format
				let timeFormat: '12h' | '24h' = '12h';
				try {
					const settings = user.settings ? JSON.parse(user.settings) : {};
					timeFormat = settings.timeFormat === '24h' ? '24h' : '12h';
				} catch {
					// Keep default
				}

				// Use contact email for reply-to if available
				const replyToEmail = user.contact_email || user.email;

				// bookingId is generated before insert

				// Two-way calendar sync via CalDAV (iCloud) if configured.
				// - Fetch availability: handled in /api/availability and /api/availability/month
				// - Write booking: create/update a VEVENT in the CalDAV calendar
				try {
					let settings: any = {};
					try {
						settings = user.settings ? JSON.parse(user.settings) : {};
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
					if (caldav?.calendarUrl && caldav?.username && caldav?.password && bookingId) {
						const caldavIcs = generateIcsInvite({
							uid: bookingId,
							summary: `${eventType.name} with ${attendeeName}`,
							description: `${eventType.description || ''}\n\nOnline Room: ${meetingUrl}\n\nAttendee: ${attendeeName} (${attendeeEmail})${notes ? `\n\nNotes from attendee:\n${notes}` : ''}`,
							location: meetingUrl || undefined,
							url: meetingUrl || undefined,
							startUtc: new Date(startTime),
							endUtc: new Date(endTime),
							organizerName: user.name,
							organizerEmail: user.contact_email || user.email,
							attendeeName,
							attendeeEmail
						});

						const resourceName = `${bookingId}.ics`;
						const eventUrl = await upsertCaldavEvent(
							{ calendarUrl: caldav.calendarUrl, username: caldav.username, password: caldav.password },
							resourceName,
							caldavIcs
						);

						await db
							.prepare('UPDATE bookings SET caldav_event_url = ?, caldav_uid = ? WHERE id = ?')
							.bind(eventUrl, bookingId, bookingId)
							.run();
					}
				} catch (caldavErr) {
					console.error('CalDAV sync error (create booking):', caldavErr);
				}

				// Get email templates to check if confirmation is enabled
				const templates = await getEmailTemplates(db, user.id);
				const confirmationEnabled = isEmailEnabled(templates, 'confirmation');

				const emailData = {
					attendeeName,
					attendeeEmail,
					eventName: eventType.name,
					eventDescription: eventType.description || '',
					startTime: startDateTime,
					endTime: endDateTime,
					meetingUrl,
					bookingId,
					hostName: user.name,
					hostEmail: user.email,
					hostContactEmail: user.contact_email || undefined,
					appUrl: env.APP_URL || '',
					timeFormat,
					timezone: timezone || 'UTC',
					brandColor: user.brand_color || undefined,
					attendeeNotes: notes || undefined
				};

				// Build ICS invite attachment (attendee + host)
				const ics = generateIcsInvite({
					uid: bookingId || crypto.randomUUID(),
					summary: `${eventType.name} with ${attendeeName}`,
					description: `${eventType.description || ''}\n\nOnline Room: ${meetingUrl}\n\nAttendee: ${attendeeName} (${attendeeEmail})${notes ? `\n\nNotes from attendee:\n${notes}` : ''}`,
							location: meetingUrl || undefined,
							url: meetingUrl || undefined,
					startUtc: new Date(startTime),
					endUtc: new Date(endTime),
					organizerName: user.name,
					organizerEmail: user.contact_email || user.email,
					attendeeName,
					attendeeEmail
				});

				const inviteAttachment = [{ filename: 'invite.ics', contentType: 'text/calendar; charset=utf-8', data: ics }];


				if (confirmationEnabled) {
					const template = templates.get('confirmation');
					await sendBookingEmail(
						{
							...emailData,
							customMessage: template?.custom_message
						},
						{
							apiKey: env.MAILGUN_API_KEY,
							apiBase: (env as any).MAILGUN_API_BASE,
							domain: env.MAILGUN_DOMAIN,
							from: env.MAILGUN_FROM,
							replyTo: env.MAILGUN_REPLY_TO || replyToEmail
						},
						template?.subject || undefined,
						inviteAttachment
					);
					attendeeEmailSent = true;
				}

				// Send admin notification email to ADMIN_EMAIL if set, else contact_email, else owner email
				const adminRecipient = env.ADMIN_EMAIL || user.contact_email || user.email;
				await sendAdminNotificationEmail(
					emailData,
					adminRecipient,
					{
						apiKey: env.MAILGUN_API_KEY,
						apiBase: (env as any).MAILGUN_API_BASE,
						domain: env.MAILGUN_DOMAIN,
						from: env.MAILGUN_FROM,
						replyTo: env.MAILGUN_REPLY_TO || replyToEmail
					},
					inviteAttachment
				);
				adminEmailSent = true;

				// Schedule reminder emails
				const reminderTypes: EmailTemplateType[] = ['reminder_24h', 'reminder_1h'];
				const reminderOffsets: Record<string, number> = {
					'reminder_24h': 24 * 60 * 60 * 1000, // 24 hours
					'reminder_1h': 60 * 60 * 1000 // 1 hour
				};

				for (const reminderType of reminderTypes) {
					if (isEmailEnabled(templates, reminderType)) {
						const scheduledFor = new Date(startDateTime.getTime() - reminderOffsets[reminderType]);
						// Only schedule if the reminder time is in the future
						if (scheduledFor > new Date()) {
							await db
								.prepare(`INSERT INTO scheduled_emails (booking_id, template_type, scheduled_for) VALUES (?, ?, ?)`)
								.bind(bookingId, reminderType, scheduledFor.toISOString())
								.run();
						}
					}
				}
			} catch (emailError: any) {
				emailSendError = emailError?.message || String(emailError);
				console.error('Failed to send booking/admin email:', emailError);
			}
		}

		return json({
			success: true,
			meetingUrl,
			email: {
				attendeeEmailSent,
				adminEmailSent,
				error: emailSendError
			}
		});
	} catch (err: any) {
		console.error('Booking creation error:', err);
		if (err?.status) throw err; // Re-throw SvelteKit errors
		throw error(500, 'Failed to create booking');
	}
};
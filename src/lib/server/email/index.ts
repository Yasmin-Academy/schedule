/**
 * Email service using Mailgun HTTP API
 *
 * This is the main entry point for the email module.
 * It re-exports types, formatters, and templates, and provides send functions.
 */

// Re-export types
export type { BookingEmailData, RescheduleEmailData, EmailTemplate, EmailTemplateType } from './types';

// Re-export formatters
export { createEmailFormatters, replaceSubjectVariables } from './formatters';

// Re-export template generators
export {
	generateBookingEmail,
	generateBookingEmailText,
	generateCancellationEmail,
	generateAdminCancellationEmail,
	generateRescheduleEmail,
	generateAdminRescheduleEmail,
	generateReminderEmail,
	getDefaultReminderSubject,
	generateAdminNotificationEmail
} from './templates';

import type { BookingEmailData, RescheduleEmailData, EmailTemplate, EmailTemplateType } from './types';
import { replaceSubjectVariables } from './formatters';
import {
	generateBookingEmail,
	generateBookingEmailText,
	generateCancellationEmail,
	generateAdminCancellationEmail,
	generateRescheduleEmail,
	generateAdminRescheduleEmail,
	generateReminderEmail,
	getDefaultReminderSubject,
	generateAdminNotificationEmail
} from './templates';

/**
 * Email configuration for sending (Mailgun)
 */
interface EmailConfig {
	apiKey: string;  // MAILGUN_API_KEY
	apiBase?: string; // MAILGUN_API_BASE (optional, e.g. https://api.eu.mailgun.net)
	domain: string;  // MAILGUN_DOMAIN (e.g. mg.yourdomain.com)
	from: string;    // MAILGUN_FROM
	replyTo?: string; // MAILGUN_REPLY_TO
}

/**
 * Mailgun accepts the "from" field as either:
 *   - "Name <email@domain.com>"
 *   - "email@domain.com"
 *
 * We sometimes want to override the display name (host name) while keeping the
 * configured sender address. If MAILGUN_FROM already contains a display name,
 * naïvely wrapping it again produces an invalid header like:
 *   "Host <Configured Name <email@...>>"
 */
function normalizeFrom(configFrom: string, displayName?: string): string {
	const trimmed = (configFrom || '').trim();
	// Extract email inside angle brackets if present.
	const m = trimmed.match(/<\s*([^>\s]+@[^>\s]+)\s*>/);
	const email = (m?.[1] ?? trimmed).trim();
	if (!displayName) return m ? trimmed : email;
	const safeName = displayName.replace(/"/g, '\\"');
	return `${safeName} <${email}>`;
}

function basicAuthHeader(username: string, password: string): string {
	const raw = `${username}:${password}`;
	// Cloudflare Workers provide btoa; Node may not. Support both.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const b64 = typeof (globalThis as any).btoa === 'function'
		? (globalThis as any).btoa(raw)
		: Buffer.from(raw, 'utf-8').toString('base64');
	return `Basic ${b64}`;
}

async function sendMailgunEmail(args: {
	config: EmailConfig;
	to: string;
	subject: string;
	html: string;
	text?: string;
	from?: string;
	replyTo?: string;
	attachments?: Array<{ filename: string; contentType: string; data: string | Uint8Array }>;
}): Promise<void> {
	const { config, to, subject, html, text, from, replyTo } = args;
	// Defensive: allow MAILGUN_DOMAIN to be provided as a full URL; normalize to a domain.
	const domain = (config.domain || '').replace(/^https?:\/\//, '').replace(/\/.*/, '').trim();
	const apiBase = (config.apiBase || 'https://api.mailgun.net').replace(/\/+$/, '');
	const url = `${apiBase}/v3/${domain}/messages`;
	const form = new FormData();
	form.set('from', from ?? config.from);
	form.set('to', to);
	form.set('subject', subject);
	form.set('html', html);
	if (text) form.set('text', text);

	const rt = replyTo ?? config.replyTo;
	if (rt) form.set('h:Reply-To', rt);

	if (args.attachments && args.attachments.length) {
		for (const a of args.attachments) {
			const blob = a.data instanceof Uint8Array ? new Blob([a.data], { type: a.contentType }) : new Blob([a.data], { type: a.contentType });
			form.append('attachment', blob, a.filename);
		}
	}
const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: basicAuthHeader('api', config.apiKey),
			},
		body: form
	});

	if (!response.ok) {
		const err = await response.text().catch(() => '');
		throw new Error(`Mailgun send failed (${response.status}): ${err}`);
	}
}

/**
 * Send booking confirmation email via Mailgun
 */
export async function sendBookingEmail(
	data: BookingEmailData,
	config: EmailConfig & { replyTo: string },
	customSubject?: string,
	attachments?: Array<{ filename: string; contentType: string; data: string | Uint8Array }>
): Promise<void> {
	const htmlBody = generateBookingEmail(data);
	const textBody = generateBookingEmailText(data);
	const subject = customSubject
		? replaceSubjectVariables(customSubject, data)
		: `Meeting Confirmed: ${data.eventName} with ${data.hostName}`;

	await sendMailgunEmail({
		config,
		to: data.attendeeEmail,
		subject,
		html: htmlBody,
		text: textBody,
		from: normalizeFrom(config.from, data.hostName),
		replyTo: config.replyTo,
		attachments
	});
}

/**
 * Send cancellation email
 */
export async function sendCancellationEmail(
	data: BookingEmailData,
	config: EmailConfig & { replyTo: string },
	customSubject?: string
): Promise<void> {
	const htmlBody = generateCancellationEmail(data);
	const subject = customSubject
		? replaceSubjectVariables(customSubject, data)
		: `Meeting Cancelled: ${data.eventName}`;

	await sendMailgunEmail({
		config,
		to: data.attendeeEmail,
		subject,
		html: htmlBody,
		from: normalizeFrom(config.from, data.hostName),
		replyTo: config.replyTo
	});
}

/**
 * Send reschedule email
 */
export async function sendRescheduleEmail(
	data: RescheduleEmailData,
	config: EmailConfig & { replyTo: string },
	customSubject?: string
): Promise<void> {
	const htmlBody = generateRescheduleEmail(data);
	const subject = customSubject
		? replaceSubjectVariables(customSubject, data)
		: `Meeting Rescheduled: ${data.eventName} with ${data.hostName}`;

	await sendMailgunEmail({
		config,
		to: data.attendeeEmail,
		subject,
		html: htmlBody,
		from: normalizeFrom(config.from, data.hostName),
		replyTo: config.replyTo
	});
}

/**
 * Send reminder email
 */
export async function sendReminderEmail(
	data: BookingEmailData,
	reminderType: 'reminder_24h' | 'reminder_1h' | 'reminder_30m',
	config: EmailConfig & { replyTo: string },
	customSubject?: string
): Promise<void> {
	const htmlBody = generateReminderEmail(data, reminderType);
	const subject = customSubject
		? replaceSubjectVariables(customSubject, data)
		: getDefaultReminderSubject(data, reminderType);

	await sendMailgunEmail({
		config,
		to: data.attendeeEmail,
		subject,
		html: htmlBody,
		from: normalizeFrom(config.from, data.hostName),
		replyTo: config.replyTo
	});
}

/**
 * Send admin notification email when a booking is made
 */
export async function sendAdminNotificationEmail(
	data: BookingEmailData,
	adminEmail: string,
	config: EmailConfig,
	attachments?: Array<{ filename: string; contentType: string; data: string | Uint8Array }>
): Promise<void> {
	const htmlBody = generateAdminNotificationEmail(data);

	await sendMailgunEmail({
		config,
		to: adminEmail,
		subject: `New Booking: ${data.eventName} with ${data.attendeeName}`,
		html: htmlBody,
		from: normalizeFrom(config.from, data.hostName || 'Scheduler'),
		attachments
	});
}

/**
 * Send admin notification for cancellation
 */
export async function sendAdminCancellationNotification(
	data: BookingEmailData,
	adminEmail: string,
	config: EmailConfig
): Promise<void> {
	const htmlBody = generateAdminCancellationEmail(data);

	await sendMailgunEmail({
		config,
		to: adminEmail,
		subject: `Booking Cancelled: ${data.eventName} with ${data.attendeeName}`,
		html: htmlBody,
		from: `${data.hostName || 'Scheduler'} <${config.from}>`,
		attachments
	});
}

/**
 * Send admin notification for reschedule
 */
export async function sendAdminRescheduleNotification(
	data: RescheduleEmailData,
	adminEmail: string,
	config: EmailConfig
): Promise<void> {
	const htmlBody = generateAdminRescheduleEmail(data);

	await sendMailgunEmail({
		config,
		to: adminEmail,
		subject: `Booking Rescheduled: ${data.eventName} with ${data.attendeeName}`,
		html: htmlBody,
		from: `${data.hostName || 'Scheduler'} <${config.from}>`,
		attachments
	});
}

/**
 * Get email templates for a user
 */
export async function getEmailTemplates(
	db: D1Database,
	userId: string
): Promise<Map<EmailTemplateType, EmailTemplate>> {
	const templates = await db
		.prepare(
			'SELECT template_type, is_enabled, subject, custom_message FROM email_templates WHERE user_id = ?'
		)
		.bind(userId)
		.all<{
			template_type: EmailTemplateType;
			is_enabled: number;
			subject: string | null;
			custom_message: string | null;
		}>();

	const map = new Map<EmailTemplateType, EmailTemplate>();
	for (const t of templates.results) {
		map.set(t.template_type, {
			template_type: t.template_type,
			is_enabled: t.is_enabled === 1,
			subject: t.subject,
			custom_message: t.custom_message
		});
	}
	return map;
}

/**
 * Check if a specific email type is enabled
 */
export function isEmailEnabled(
	templates: Map<EmailTemplateType, EmailTemplate>,
	type: EmailTemplateType
): boolean {
	const template = templates.get(type);
	return template ? template.is_enabled : true;
}
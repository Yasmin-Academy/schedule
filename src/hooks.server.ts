import type { Handle } from '@sveltejs/kit';

/**
 * CORS for the embeddable widget.
 *
 * We only enable CORS on *public widget-facing API endpoints*.
 * Everything else (dashboard, auth, admin APIs) remains same-origin only.
 */
const PUBLIC_CORS_PREFIXES = ['/api/availability', '/api/bookings', '/api/public/event-type'];

/**
 * Comma-separated allowlist of origins that may embed the widget.
 *
 * Examples:
 * - http://localhost:5174
 * - https://www.yoursite.com
 * - https://app.yoursite.com
 */
function getAllowedOrigins(event: Parameters<Handle>[0]['event']): Set<string> {
	const raw =
		(event.platform as any)?.env?.WIDGET_ALLOWED_ORIGINS ||
		(event.platform as any)?.env?.CORS_ALLOWED_ORIGINS ||
		'';

	const set = new Set(
		raw
			.split(',')
			.map((s: string) => s.trim())
			.filter(Boolean)
	);

	// Developer-friendly default for local testing if no allowlist is configured.
	// This prevents the "blank widget" experience when running a separate local site.
	if (set.size === 0) {
		set.add('http://localhost:5174');
		set.add('http://127.0.0.1:5174');
	}

	return set;
}

function isOriginAllowed(origin: string | null, allowed: Set<string>): boolean {
	if (!origin) return false;
	return allowed.has(origin);
}

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	const isPublicApi = PUBLIC_CORS_PREFIXES.some((p) => pathname.startsWith(p));

	// Only apply CORS rules to widget-facing endpoints
	if (!isPublicApi) {
		return resolve(event);
	}

	const origin = event.request.headers.get('Origin');
	const allowed = getAllowedOrigins(event);
	const ok = isOriginAllowed(origin, allowed);

	// Preflight requests
	if (event.request.method === 'OPTIONS') {
		if (!ok) {
			return new Response('CORS origin not allowed', { status: 403 });
		}
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': origin!,
				'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
				'Access-Control-Max-Age': '86400',
				Vary: 'Origin'
			}
		});
	}

	const response = await resolve(event);
	if (ok) {
		response.headers.set('Access-Control-Allow-Origin', origin!);
		response.headers.set('Vary', 'Origin');
	}
	return response;
};

/**
 * Server-side authentication utilities (password-based)
 * Single-user system - one admin password
 */

import type { RequestEvent } from '@sveltejs/kit';

type OwnerUserRow = { id: string; email: string; name: string; slug: string };

/**
 * Create session token (simple JWT-like token)
 */
export async function createSessionToken(userId: string, secret: string): Promise<string> {
	const payload = {
		userId,
		iat: Date.now()
	};

	const data = btoa(JSON.stringify(payload));
	const signature = await hashString(`${data}.${secret}`);

	return `${data}.${signature}`;
}

/**
 * Verify session token
 */
export async function verifySessionToken(
	token: string,
	secret: string
): Promise<{ userId: string } | null> {
	try {
		const [data, signature] = token.split('.');
		const expectedSignature = await hashString(`${data}.${secret}`);
		if (signature !== expectedSignature) return null;

		const payload = JSON.parse(atob(data));

		// 7 days
		const age = Date.now() - payload.iat;
		if (age > 7 * 24 * 60 * 60 * 1000) return null;

		return { userId: payload.userId };
	} catch {
		return null;
	}
}

/**
 * Hash string using Web Crypto API
 */
async function hashString(str: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get current user from session cookie
 */
export async function getCurrentUser(event: RequestEvent): Promise<string | null> {
	const sessionToken = event.cookies.get('session');
	if (!sessionToken) return null;

	const jwtSecret = event.platform?.env?.JWT_SECRET;
	if (!jwtSecret) return null;

	const session = await verifySessionToken(sessionToken, jwtSecret);
	return session?.userId ?? null;
}

/**
 * Require authentication
 */
export async function requireAuth(event: RequestEvent): Promise<string> {
	const userId = await getCurrentUser(event);
	if (!userId) throw new Error('Not authenticated');
	return userId;
}

/**
 * Check the admin password from env.
 */
export function isValidAdminPassword(event: RequestEvent, password: string): boolean {
	const expected = String(event.platform?.env?.ADMIN_PASSWORD ?? '');
	const normalize = (s: string) =>
		s.replace(/\r/g, '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

	return normalize(password) === normalize(expected);
}

/**
 * Get (or create) the single owner user in the DB and return their user id.
 * This keeps compatibility with the existing schema that references users.id everywhere.
 */
export async function getOrCreateOwnerUserId(event: RequestEvent): Promise<string> {
	const env = event.platform?.env;
	const db = env?.DB as D1Database | undefined;
	if (!db) throw new Error('DB not available');

	// Use the first user as the owner if it exists
	const existing = await db
		.prepare('SELECT id, email, name, slug FROM users ORDER BY created_at ASC LIMIT 1')
		.first<OwnerUserRow>();

	if (existing?.id) return existing.id;

	// Otherwise create owner from env
	const email = env?.OWNER_EMAIL ?? env?.ADMIN_EMAIL;
	const name = env?.OWNER_NAME ?? 'Owner';
	const slug = env?.OWNER_SLUG ?? 'owner';

	if (!email) {
		throw new Error('No users exist yet. Set OWNER_EMAIL in env to create the owner user.');
	}

	await db
		.prepare(
			`INSERT INTO users (email, name, slug, timezone, settings, brand_color, contact_email)
			 VALUES (?, ?, ?, 'UTC', '{}', '#3b82f6', ?)`
		)
		.bind(email, name, slug, email)
		.run();

	const created = await db
		.prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
		.bind(email)
		.first<{ id: string }>();

	if (!created?.id) throw new Error('Failed to create owner user');
	return created.id;
}
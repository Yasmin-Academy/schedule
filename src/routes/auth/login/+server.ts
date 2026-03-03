import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSessionToken, isValidAdminPassword, getOrCreateOwnerUserId } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	const env = event.platform?.env;
	if (!env) throw new Error('Platform env not available');

	let password = '';

	// Accept either JSON or form posts
	const contentType = event.request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		const body = (await event.request.json().catch(() => ({}))) as { password?: string };
		password = (body.password ?? '').trim();
	} else {
		const form = await event.request.formData();
		password = String(form.get('password') ?? '').trim();
	}
	
	const expected = env.ADMIN_PASSWORD ?? '';
const submitted = password ?? '';

const norm = (s: string) =>
  s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

const expectedN = norm(expected);
const submittedN = norm(submitted);

	if (!isValidAdminPassword(event, password)) {
		return json({ ok: false, error: 'Invalid password' }, { status: 401 });
	}

	const jwtSecret = env.JWT_SECRET;
	if (!jwtSecret) throw new Error('Missing JWT_SECRET');

	// Use real users.id in the session (compatible with schema)
	const ownerUserId = await getOrCreateOwnerUserId(event);
	const sessionToken = await createSessionToken(ownerUserId, jwtSecret);
	const isDev = event.url.hostname === 'localhost' || event.url.hostname === '127.0.0.1';

event.cookies.set('session', sessionToken, {
  path: '/',
  httpOnly: true,
  secure: event.url.protocol === 'https:',
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 7
});

	throw redirect(303, '/dashboard');
};

export const GET: RequestHandler = async () => {
	throw redirect(303, '/dashboard');
};
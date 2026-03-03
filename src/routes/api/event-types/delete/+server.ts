import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const env = event.platform?.env;
	const db = env?.DB as D1Database | undefined;
	if (!db) throw error(500, 'DB not available');

	const form = await event.request.formData();
	const id = String(form.get('id') ?? '').trim();
	if (!id) throw error(400, 'Missing id');

	// If there are existing bookings, archive instead of deleting.
	const bookingCountRow = await db
		.prepare('SELECT COUNT(*) as cnt FROM bookings WHERE event_type_id = ?')
		.bind(id)
		.first<{ cnt: number }>();
	const bookingCount = Number(bookingCountRow?.cnt ?? 0);

	if (bookingCount > 0) {
		// Archive: hide from booking page, and avoid slug collisions.
		await db
			.prepare(
				"UPDATE event_types SET is_active = 0, name = name || ' (Archived)', slug = slug || '-archived-' || substr(id, 1, 6) WHERE id = ?"
			)
			.bind(id)
			.run();
		throw redirect(303, '/dashboard');
	}

	// No bookings: safe to delete.
	await db.prepare('DELETE FROM availability_rules WHERE event_type_id = ?').bind(id).run();
	await db.prepare('DELETE FROM event_types WHERE id = ?').bind(id).run();

	throw redirect(303, '/dashboard');
};

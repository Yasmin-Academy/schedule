/**
 * Calendar Settings page
 *
 * Google/Outlook integrations removed.
 * Hosts can connect iCloud Calendar via CalDAV.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCurrentUser } from '$lib/server/auth';

export const load: PageServerLoad = async (event) => {
	const userId = await getCurrentUser(event);
	if (!userId) throw redirect(302, '/login');

	const db = event.platform?.env?.DB;
	if (!db) return { user: null };

	const userRow = await db
		.prepare('SELECT settings FROM users WHERE id = ?')
		.bind(userId)
		.first<{ settings: string | null }>();

	let settings: any = {};
	try {
		settings = userRow?.settings ? JSON.parse(userRow.settings) : {};
	} catch {
		settings = {};
	}

	return {
		user: {
			caldav: settings.caldav || {}
		}
	};
};

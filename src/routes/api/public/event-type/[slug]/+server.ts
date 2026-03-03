import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, platform }) => {
	const env = platform?.env;
	if (!env) throw error(500, 'Platform env not available');
	const db = env.DB;

	const slug = params.slug;
	if (!slug) throw error(400, 'Missing event slug');

	// Single-user setup
	const user = await db
		.prepare('SELECT id, name, slug as user_slug, brand_color, settings FROM users LIMIT 1')
		.first<{ id: string; name: string; user_slug: string; brand_color: string | null; settings: string | null }>();
	if (!user) throw error(404, 'Host not found');

	const eventType = await db
		.prepare(
			// NOTE: schema.sql uses `cover_image` (legacy). Some earlier versions used `cover_image_url`.
			// We alias `cover_image` to `cover_image_url` for widget compatibility.
			'SELECT id, name, slug, description, duration_minutes as duration, location_type, location_details, cover_image as cover_image_url FROM event_types WHERE user_id = ? AND slug = ? AND is_active = 1'
		)
		.bind(user.id, slug)
		.first<{
			id: string;
			name: string;
			slug: string;
			description: string | null;
			duration: number;
			location_type: string | null;
			location_details: string | null;
			cover_image_url: string | null;
		}>();

	if (!eventType) throw error(404, 'Event type not found');

	let settings: any = {};
	try {
		settings = user.settings ? JSON.parse(user.settings) : {};
	} catch {
		settings = {};
	}

	return json({
		host: {
			name: user.name,
			slug: user.user_slug,
			brandColor: user.brand_color || '#3b82f6',
			// optional widget defaults
			timeFormat: settings.timeFormat === '24h' ? '24h' : '12h',
			widgetTranslations: settings.widgetTranslations || {},
			translations: settings.translations || {}
		},
		eventType
	});
};

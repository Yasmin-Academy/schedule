import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getCurrentUser } from '$lib/server/auth';
import { EN_TRANSLATIONS, AR_TRANSLATIONS, ALL_TRANSLATION_KEYS } from '$lib/i18n/template';
import type { Actions } from './$types';

export const load: PageServerLoad = async (event) => {
  const userId = await getCurrentUser(event);
  if (!userId) throw redirect(302, '/login');

  const env = event.platform?.env;
  if (!env) throw redirect(302, '/login');
  const db = env.DB;

  const user = await db
    .prepare('SELECT settings FROM users WHERE id = ?')
    .bind(userId)
    .first<{ settings: string | null }>();

  let settings: any = {};
  try {
    settings = user?.settings ? JSON.parse(user.settings) : {};
  } catch {
    settings = {};
  }

  return {
    translations: settings.translations || {},
    template: {
      keys: ALL_TRANSLATION_KEYS,
      en: EN_TRANSLATIONS,
      ar: AR_TRANSLATIONS
    }
  };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await getCurrentUser(event);
    if (!userId) throw redirect(302, '/login');

    const env = event.platform?.env;
    if (!env) throw redirect(302, '/login');
    const db = env.DB;

    const form = await event.request.formData();
    const translationsJson = String(form.get('translations_json') || '').trim();

    let incoming: any = {};
    try {
      incoming = translationsJson ? JSON.parse(translationsJson) : {};
    } catch {
      incoming = {};
    }

    // Persist under settings.translations
    const row = await db
      .prepare('SELECT settings FROM users WHERE id = ?')
      .bind(userId)
      .first<{ settings: string | null }>();

    let settings: any = {};
    try {
      settings = row?.settings ? JSON.parse(row.settings) : {};
    } catch {
      settings = {};
    }

    settings.translations = {
      en: incoming.en || {},
      ar: incoming.ar || {}
    };

    await db
      .prepare('UPDATE users SET settings = ? WHERE id = ?')
      .bind(JSON.stringify(settings), userId)
      .run();

    return { success: true };
  }
};

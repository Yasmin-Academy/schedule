import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCurrentUser } from '$lib/server/auth';
import { discoverIcloudCalendars } from '$lib/server/caldav';

export const POST: RequestHandler = async (event) => {
  const userId = await getCurrentUser(event);
  if (!userId) return new Response('Unauthorized', { status: 401 });

  let body: any = {};
  try {
    body = await event.request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '').trim();
  if (!username || !password) return new Response('Missing username/password', { status: 400 });

  try {
    const result = await discoverIcloudCalendars(username, password);
    return json(result);
  } catch (e: any) {
    const msg = e?.message ?? 'Discovery failed';
    return new Response(msg, { status: 400 });
  }
};

/**
 * Availability revision
 *
 * Goal: make availability changes reflect immediately without expensive cache purges.
 *
 * Approach:
 * - We keep a single KV key `availability:rev`.
 * - Availability cache keys include this rev, so bumping the rev invalidates all cached availability.
 * - We use KV get with cacheTtl to keep KV usage low.
 */

import type { KVNamespace } from '@cloudflare/workers-types';

const REV_KEY = 'availability:rev';

export async function getAvailabilityRevision(kv: KVNamespace): Promise<string> {
	// cacheTtl keeps this value in Cloudflare edge cache, reducing KV read usage.
	// 30s is a good tradeoff: near-instant invalidation for admin actions, low KV reads.
	const rev = await kv.get(REV_KEY, { cacheTtl: 30 });
	return rev || '0';
}

export async function bumpAvailabilityRevision(kv: KVNamespace): Promise<string> {
	const newRev = String(Date.now());
	// Keep this key effectively permanent; it is tiny.
	await kv.put(REV_KEY, newRev);
	return newRev;
}

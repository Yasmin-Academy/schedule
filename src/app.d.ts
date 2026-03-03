/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

declare global {
	namespace App {
		interface Platform {
			env: {
				DB: D1Database;
				KV: KVNamespace;

				// App / URLs
				BASE_URL: string;
				APP_URL?: string;
			MAIN_DOMAIN?: string;

				// Auth (password login)
				JWT_SECRET: string;
				ADMIN_PASSWORD: string;

				// Single-owner user bootstrap (used if DB has no users yet)
				OWNER_EMAIL?: string;
				OWNER_NAME?: string;
				OWNER_SLUG?: string;

				// Email (Mailgun)
				MAILGUN_API_KEY?: string;
				MAILGUN_API_BASE?: string;
				MAILGUN_DOMAIN?: string;
				MAILGUN_FROM?: string;
				MAILGUN_REPLY_TO?: string;

				// Optional anti-spam / cron
				TURNSTILE_SECRET_KEY?: string;
				CRON_SECRET?: string;

				// Legacy / to be removed later (keeping optional to avoid breaking deploys during refactor)
				ADMIN_EMAIL?: string;
				EMAIL_FROM?: string;
			context: {
				waitUntil(promise: Promise<any>): void;
			};
			caches: CacheStorage & { default: Cache };
		}

		interface Locals {
			user?: {
				id: string;
				email: string;
				name: string;
			};
		}
	}
}

export {};
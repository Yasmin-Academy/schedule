<script lang="ts">
	interface Props {
		user: {
			caldav?: {
				calendarUrl?: string;
				username?: string;
				// never prefill password
			};
		} | null;
	}

	let { user }: Props = $props();

	let saving = $state(false);
	let discovering = $state(false);
	let error = $state('');
	let discoverError = $state('');

	let caldavUsername = $state(user?.caldav?.username || '');
	let caldavPassword = $state('');

	// discovered calendars
	type CalItem = { name: string; url: string };
	let calendars: CalItem[] = $state([]);
	let selectedUrl = $state(user?.caldav?.calendarUrl || '');

	async function discover() {
		discovering = true;
		discoverError = '';
		error = '';
		calendars = [];
		try {
			const res = await fetch('/api/caldav/discover', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: caldavUsername.trim(),
					password: caldavPassword.trim()
				})
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(t || `Discovery failed (${res.status})`);
			}
			const data = await res.json();
			calendars = (data?.calendars ?? []) as CalItem[];
			selectedUrl = (data?.defaultUrl as string) || calendars?.[0]?.url || '';
			if (!calendars.length) {
				throw new Error('No calendars found. Make sure Calendar is enabled in iCloud and try again.');
			}
		} catch (e: any) {
			discoverError = e?.message ?? 'Discovery failed';
		} finally {
			discovering = false;
		}
	}

	async function save() {
		saving = true;
		error = '';
		try {
			if (!selectedUrl?.trim()) throw new Error('Please discover and select a calendar first.');

			const caldav = {
				calendarUrl: selectedUrl.trim(),
				username: caldavUsername.trim(),
				password: caldavPassword.trim() || undefined
			};

			const res = await fetch('/api/profile', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ caldav })
			});

			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(t || `Save failed (${res.status})`);
			}
		} catch (e: any) {
			error = e?.message ?? 'Failed to save';
		} finally {
			saving = false;
		}
	}
</script>

<div class="bg-white shadow rounded-lg p-6">
	<h2 class="text-lg font-semibold text-gray-900 mb-2">iCloud Calendar (CalDAV)</h2>
	<p class="text-sm text-gray-600 mb-4">
		Connect your iCloud calendar using CalDAV so availability is fetched from your real calendar and bookings are written back.
		Use an <span class="font-semibold">app-specific password</span> from Apple ID (recommended).
	</p>

	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1" for="caldavUsername">iCloud email (Apple ID)</label>
			<input
				id="caldavUsername"
				type="text"
				class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
				placeholder="your-apple-id@email.com"
				bind:value={caldavUsername}
			/>
		</div>

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1" for="caldavPassword">App-specific password</label>
			<input
				id="caldavPassword"
				type="password"
				autocomplete="new-password"
				class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
				placeholder="••••••••••••••••"
				bind:value={caldavPassword}
			/>
			<p class="mt-1 text-xs text-gray-500">We do not prefill this value. Leave blank to keep the currently saved password.</p>
		</div>

		<div class="md:col-span-2 flex items-center gap-3">
			<button
				class="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-black disabled:opacity-50"
				onclick={discover}
				disabled={discovering || !caldavUsername.trim() || !caldavPassword.trim()}
			>
				{discovering ? 'Discovering…' : 'Discover calendars'}
			</button>
			<p class="text-xs text-gray-500">
				This automatically finds your iCloud calendar URLs — no manual CalDAV URL needed.
			</p>
		</div>

		{#if discoverError}
			<div class="md:col-span-2">
				<p class="text-sm text-red-600">{discoverError}</p>
			</div>
		{/if}

		{#if calendars.length}
			<div class="md:col-span-2">
				<label class="block text-sm font-medium text-gray-700 mb-1" for="caldavCalendar">
					Select calendar
				</label>
				<select
					id="caldavCalendar"
					class="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
					bind:value={selectedUrl}
				>
					{#each calendars as c}
						<option value={c.url}>{c.name}</option>
					{/each}
				</select>
				<p class="mt-1 text-xs text-gray-500">
					After saving, availability will be blocked by busy events in this calendar and new bookings will be added to it.
				</p>
			</div>
		{/if}
	</div>

	{#if error}
		<p class="mt-3 text-sm text-red-600">{error}</p>
	{/if}

	<div class="mt-4 flex items-center gap-3">
		<button
			class="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
			onclick={save}
			disabled={saving || !selectedUrl}
		>
			{saving ? 'Saving…' : 'Save'}
		</button>

		<p class="text-xs text-gray-500">
			You can change calendars anytime. Password is only updated if you type a new one.
		</p>
	</div>
</div>

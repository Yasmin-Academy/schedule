<script lang="ts">
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TimezoneSelector from '$lib/components/TimezoneSelector.svelte';

	// Svelte 5 "runes" mode does not allow `export let`.
	// Use `$props()` to access page props from SvelteKit.
	type PageData = {
		slug?: string;
		timezone: string;
		caldavConnected: boolean;
		events: Array<{ uid?: string; summary?: string; start: string; end: string; allDay?: boolean }>;
		availabilityRules: Array<{ id: number; day_of_week: number; start_time: string; end_time: string }>;
		error: string | null;
		month: { y: number; m: number };
		windowStart: string;
		windowEnd: string;
	};

	let { data } = $props<{ data: PageData }>();

	// In Svelte 5 runes mode, component state that should trigger UI updates
	// must be created with $state().
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let tzSaving = $state(false);
	let tzError = $state<string | null>(null);
	let showTimezoneDropdown = $state(false);
	let selectedTimezone = $state(data.timezone || 'UTC');
	let summary = $state('Blocked');
	let date = $state('');
	let selectedDay = $state('');
	let startTime = $state('09:00');
	let endTime = $state('10:00');

	// -------- Date helpers (timezone-safe for calendar rendering) --------
	// We build the grid using *calendar dates* (YYYY-MM-DD strings) and do
	// all arithmetic in UTC so SSR/client/timezone offsets can't shift days.
	function pad2(n: number) {
		return String(n).padStart(2, '0');
	}

	function ymdFromParts(y: number, m: number, d: number) {
		return `${y}-${pad2(m)}-${pad2(d)}`;
	}

	function partsFromYmd(ymd: string): { y: number; m: number; d: number } {
		const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(ymd);
		if (!m) return { y: 1970, m: 1, d: 1 };
		return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
	}

	function addDaysYmd(ymd: string, deltaDays: number) {
		const p = partsFromYmd(ymd);
		const ms = Date.UTC(p.y, p.m - 1, p.d) + deltaDays * 86400000;
		const d = new Date(ms);
		return ymdFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
	}

	function dayOfWeekYmd(ymd: string) {
		const p = partsFromYmd(ymd);
		return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0..6, Sun..Sat
	}

	function toYmdInTz(d: Date, timeZone: string = data.timezone) {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(d);
		const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
		return `${get('year')}-${get('month')}-${get('day')}`;
	}

	function isoToYmd(iso: string, timeZone: string = data.timezone) {
		const d = new Date(iso);
		if (!iso || Number.isNaN(d.getTime())) return '';
		return toYmdInTz(d, timeZone);
	}

	function monthGridYmd(y: number, m: number) {
		const firstOfMonth = ymdFromParts(y, m, 1);
		const firstDow = dayOfWeekYmd(firstOfMonth); // Sun=0
		const start = addDaysYmd(firstOfMonth, -firstDow);
		const days: string[] = [];
		for (let i = 0; i < 42; i++) days.push(addDaysYmd(start, i));
		return days;
	}

	function eventsForDay(ymd: string) {
		// Group by the dashboard user's timezone (not by UTC string slicing).
		return (data.events || []).filter((e) => {
			const key = e?.start ? isoToYmd(e.start) : '';
			return key === ymd;
		});
	}

	function availabilityForDay(ymd: string) {
		const dow = dayOfWeekYmd(ymd);
		return (data.availabilityRules || []).filter((r) => r.day_of_week === dow);
	}

	// Initialize date + selected day on first load.
	// (Runes mode: use $effect instead of legacy $: reactive blocks.)
	$effect(() => {
		const today = toYmdInTz(new Date());
		if (!date) date = today;
		const urlDay = $page.url.searchParams.get('day');
		if (!selectedDay) selectedDay = urlDay || today;
	});

	// Keep selector in sync if the server-updated timezone changes.
	$effect(() => {
		selectedTimezone = data.timezone || 'UTC';
	});

	function handleTimezoneSubmit() {
		tzSaving = true;
		tzError = null;
		return async ({ update, result }: any) => {
			await update({ reset: false });
			tzSaving = false;
			if (result.type === 'failure') {
				tzError = result.data?.error || 'Failed to update timezone';
				return;
			}
			// Revalidate all dashboard data so the change is reflected everywhere.
			await invalidateAll();
		};
	}

	function formatLocal(iso: string) {
		if (!iso) return '—';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '—';
		try {
			return new Intl.DateTimeFormat(undefined, {
				timeZone: data.timezone,
				weekday: 'short',
				year: 'numeric',
				month: 'short',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit'
			}).format(d);
		} catch {
			return '—';
		}
	}

	function formatLocalDateOnly(iso: string) {
		if (!iso) return '—';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '—';
		try {
			return new Intl.DateTimeFormat(undefined, {
				// These window boundaries are produced as UTC-midnight timestamps.
				// Formatting them in a negative offset timezone (e.g. America/New_York) shifts into the previous day.
				// Render date-only values in UTC to avoid "Feb 28" for "Mar 1".
				timeZone: 'UTC',
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			}).format(d);
		} catch {
			return d.toDateString();
		}
	}

	async function createBlock() {
		createError = null;
		if (!date) {
			createError = 'Pick a date.';
			return;
		}
		creating = true;
		try {
			const start = new Date(`${date}T${startTime}:00`);
			const end = new Date(`${date}T${endTime}:00`);
			const res = await fetch('/api/caldav/block', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ start: start.toISOString(), end: end.toISOString(), summary })
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.error || 'Failed to create event');
			await invalidateAll();
		} catch (e: any) {
			createError = e?.message || 'Failed to create event';
		} finally {
			creating = false;
		}
	}

	// Important: avoid UTC-midnight → local-time shifting into the previous month (common in -0500).
	const monthLabel = $derived.by(() =>
		new Date(Date.UTC(data.month.y, data.month.m - 1, 15, 12, 0, 0)).toLocaleString(undefined, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);

	const selectedEvents = $derived.by(() => (selectedDay ? eventsForDay(selectedDay) : []));
	const selectedAvailability = $derived.by(() => (selectedDay ? availabilityForDay(selectedDay) : []));

	async function nav(delta: number) {
		const y = data.month.y;
		const m = data.month.m + delta;
		const d = new Date(Date.UTC(y, m - 1, 1));
		const ny = d.getUTCFullYear();
		const nm = d.getUTCMonth() + 1;
		const url = new URL($page.url);
		url.searchParams.set('y', String(ny));
		url.searchParams.set('m', String(nm));
		// Keep the selected day visually stable: default to the first of the shown month.
		url.searchParams.set('day', ymdFromParts(ny, nm, 1));
		await goto(url.toString(), { replaceState: true, noScroll: true });
		await invalidateAll();
	}

	async function setDay(ymd: string) {
		selectedDay = ymd;
		date = ymd;
		const [yy, mm] = ymd.split('-').map((v) => Number(v));
		const monthChanged = yy !== data.month.y || mm !== data.month.m;
		const url = new URL($page.url);
		url.searchParams.set('day', ymd);
		await goto(url.toString(), { replaceState: true, noScroll: true });
		// If the user clicks a day from an adjacent month visible in the grid,
		// refresh server data so the whole calendar view updates to that month.
		if (monthChanged) await invalidateAll();
	}

	const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const hours = Array.from({ length: 24 }, (_, i) => i);

	function timeOptions(stepMinutes = 15) {
		const out: string[] = [];
		for (let h = 0; h < 24; h++) {
			for (let m = 0; m < 60; m += stepMinutes) out.push(`${pad2(h)}:${pad2(m)}`);
		}
		return out;
	}
	const times = timeOptions(15);

	function toDisplayDate(ymd: string) {
		const p = partsFromYmd(ymd);
		// Use UTC here because y/m/d already represent the calendar date.
		return new Date(Date.UTC(p.y, p.m - 1, p.d));
	}

	function minutesFromTimeStr(t: string) {
		const m = /^([0-9]{2}):([0-9]{2})$/.exec(t || '');
		if (!m) return 0;
		return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
	}

	function minutesInTz(iso: string, timeZone: string = data.timezone) {
		const d = new Date(iso);
		if (!iso || Number.isNaN(d.getTime())) return null;
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).formatToParts(d);
		const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
		const hh = parseInt(get('hour') || '0', 10);
		const mm = parseInt(get('minute') || '0', 10);
		return hh * 60 + mm;
	}

	function clamp(n: number, a: number, b: number) {
		return Math.max(a, Math.min(b, n));
	}

	const timelineBlocks = $derived.by(() => {
		const blocks: Array<{ type: 'busy' | 'avail'; top: number; height: number; label: string }> = [];
		// Availability blocks
		for (const r of selectedAvailability || []) {
			const s = minutesFromTimeStr(r.start_time);
			const e = minutesFromTimeStr(r.end_time);
			const top = (clamp(s, 0, 1440) / 1440) * 100;
			const height = (clamp(Math.max(e - s, 0), 0, 1440) / 1440) * 100;
			blocks.push({ type: 'avail', top, height, label: `${r.start_time}–${r.end_time}` });
		}

		// Busy event blocks (clamped to this day)
		for (const ev of selectedEvents || []) {
			if (ev.allDay) {
				blocks.push({ type: 'busy', top: 0, height: 100, label: ev.summary || 'All day' });
				continue;
			}
			const s = minutesInTz(ev.start);
			const e = minutesInTz(ev.end);
			if (s == null || e == null) continue;
			const ss = clamp(s, 0, 1440);
			const ee = clamp(Math.max(e, ss + 1), 0, 1440);
			const top = (ss / 1440) * 100;
			const height = ((ee - ss) / 1440) * 100;
			blocks.push({ type: 'busy', top, height, label: ev.summary || 'Busy' });
		}

		// Paint availability first, then busy on top (busy last)
		blocks.sort((a, b) => (a.type === b.type ? a.top - b.top : a.type === 'avail' ? -1 : 1));
		return blocks;
	});

	function clampEndAfterStart() {
		if (!startTime || !endTime) return;
		if (endTime <= startTime) {
			// bump end by 30 mins
			const idx = Math.max(0, times.indexOf(startTime));
			endTime = times[Math.min(times.length - 1, idx + 2)] || endTime;
		}
	}
	$effect(() => {
		clampEndAfterStart();
	});
</script>

<div class="min-h-screen bg-gray-50">
	<header class="bg-white shadow-sm">
		<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex items-center gap-4">
					<a href="/dashboard" class="text-gray-600 hover:text-gray-900">← Back to Dashboard</a>
					<h1 class="text-2xl font-bold text-gray-900">Calendar</h1>
				</div>

				<!-- Timezone (synced across dashboard) -->
				<form
					method="POST"
					action="?/setTimezone"
					use:enhance={handleTimezoneSubmit}
					class="flex items-center gap-3"
				>
					<input type="hidden" name="timezone" value={selectedTimezone} />
					<div class="relative">
						<button
							type="button"
							onclick={() => (showTimezoneDropdown = !showTimezoneDropdown)}
							class="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:border-gray-400 transition bg-white"
						>
							<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
							</svg>
							<span class="text-sm font-medium text-gray-900">{selectedTimezone}</span>
							<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
							</svg>
						</button>
						{#if showTimezoneDropdown}
							<TimezoneSelector
								selectedTimezone={selectedTimezone}
								onSelect={(tz) => (selectedTimezone = tz)}
								onClose={() => (showTimezoneDropdown = false)}
							/>
						{/if}
					</div>
					<button
						type="submit"
						disabled={tzSaving}
						class="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
					>
						{tzSaving ? 'Saving…' : 'Save'}
					</button>
				</form>
			</div>
			{#if tzError}
				<div class="mt-3 bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">
					{tzError}
				</div>
			{/if}
		</div>
	</header>

	<!-- Existing calendar UI -->

<div class="max-w-6xl mx-auto px-4 py-8">
	<div class="flex items-center justify-between gap-4 mb-6">
		<div>
			<h1 class="text-2xl font-semibold">Calendar</h1>
			<p class="text-sm text-gray-600">Timezone: {data.timezone}</p>
		</div>
		<div class="flex items-center gap-2">
			<button class="px-3 py-2 rounded border" onclick={() => nav(-1)}>Prev</button>
			<div class="px-3 py-2 rounded bg-gray-50 border text-sm">{monthLabel}</div>
			<button class="px-3 py-2 rounded border" onclick={() => nav(1)}>Next</button>
		</div>
	</div>

	{#if !data.caldavConnected}
		<div class="p-4 rounded border bg-yellow-50">
			<p class="text-sm">Connect CalDAV in <a class="underline" href="/dashboard/calendars">Calendars</a> to view and block time.</p>
		</div>
	{:else}
		{#if data.error}
			<div class="p-4 rounded border bg-red-50 mb-4">
				<p class="text-sm text-red-700">{data.error}</p>
			</div>
		{/if}

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="lg:col-span-2">
				<div class="rounded border bg-white">
					<div class="p-4 border-b">
						<div class="flex items-center justify-between">
							<div>
								<h2 class="font-medium">Calendar</h2>
								<p class="text-sm text-gray-600">Month view with your busy times and weekly availability overlay.</p>
							</div>
							<div class="text-sm text-gray-500">Timezone: {data.timezone}</div>
						</div>
					</div>
					<div class="p-4">
						<div class="grid grid-cols-7 text-xs text-gray-500 mb-2">
							{#each weekdayLabels as w}
								<div class="py-1">{w}</div>
							{/each}
						</div>
						<div class="grid grid-cols-7 gap-2">
							{#each monthGridYmd(data.month.y, data.month.m) as ymd}
								{@const p = partsFromYmd(ymd)}
								{@const inMonth = p.m === data.month.m}
								{@const isToday = ymd === toYmdInTz(new Date())}
								{@const cnt = eventsForDay(ymd).length}
								{@const avail = availabilityForDay(ymd)}
								<button
									type="button"
									class="group text-left border rounded-lg p-2 min-h-[86px] hover:bg-gray-50 transition"
									class:opacity-50={!inMonth}
									class:ring-2={ymd === selectedDay}
									class:ring-blue-500={ymd === selectedDay}
									onclick={() => setDay(ymd)}
								>
									<div class="flex items-start justify-between gap-2">
										<div class="text-sm font-semibold" class:text-blue-600={isToday}>{p.d}</div>
										<div class="flex items-center gap-1">
											{#if avail.length > 0}
												<span class="inline-flex h-2 w-2 rounded-full bg-emerald-500" title="Availability"></span>
											{/if}
											{#if cnt > 0}
												<span class="inline-flex items-center justify-center text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{cnt}</span>
											{/if}
										</div>
									</div>

									{#if avail.length > 0}
										<div class="mt-2 text-[11px] text-emerald-700 bg-emerald-50 rounded px-2 py-1 line-clamp-2">
											Available {avail[0].start_time}–{avail[0].end_time}{avail.length > 1 ? ` +${avail.length - 1}` : ''}
										</div>
									{:else if cnt > 0}
										<div class="mt-2 text-[11px] text-gray-600 line-clamp-2">
											{eventsForDay(ymd)[0].summary || 'Busy'}{cnt > 1 ? ' +' + (cnt - 1) + ' more' : ''}
										</div>
									{:else}
										<div class="mt-2 text-[11px] text-gray-400">No events</div>
									{/if}
								</button>
							{/each}
						</div>

						<div class="mt-6">
							<div class="flex items-start justify-between gap-4 mb-3">
								<div>
									<div class="text-sm font-semibold">
										{toDisplayDate(selectedDay).toLocaleDateString(undefined, {
											weekday: 'long',
											month: 'long',
											day: 'numeric',
											year: 'numeric'
										})}
									</div>
									<div class="text-xs text-gray-500">
										Range: {formatLocalDateOnly(data.windowStart)} → {formatLocalDateOnly(data.windowEnd)}
									</div>
								</div>
								<div class="flex items-center gap-2">
									<button class="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50" onclick={() => setDay(toYmdInTz(new Date()))}>Today</button>
								</div>
							</div>

							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								<!-- Availability summary -->
								<div class="rounded-lg border p-4">
									<div class="flex items-center justify-between mb-2">
										<div class="text-sm font-medium">Availability</div>
										<div class="text-xs text-gray-500">{data.timezone}</div>
									</div>
									{#if selectedAvailability.length === 0}
										<div class="text-sm text-gray-600">No availability rules for this day.</div>
									{:else}
										<ul class="space-y-2">
											{#each selectedAvailability as r}
												<li class="flex items-center justify-between rounded bg-emerald-50 px-3 py-2">
													<span class="text-sm text-emerald-900">Available</span>
													<span class="text-sm font-medium text-emerald-900">{r.start_time}–{r.end_time}</span>
												</li>
											{/each}
										</ul>
									{/if}
								</div>

								<!-- Events list -->
								<div class="rounded-lg border p-4">
									<div class="flex items-center justify-between mb-2">
										<div class="text-sm font-medium">Busy events</div>
										<div class="text-xs text-gray-500">{selectedEvents.length} item(s)</div>
									</div>
									{#if selectedEvents.length === 0}
										<div class="text-sm text-gray-600">No events on this day.</div>
									{:else}
										<ul class="space-y-2">
											{#each selectedEvents as ev}
												<li class="rounded-lg border px-3 py-2">
													<div class="font-medium text-sm">{ev.summary || 'Busy'}</div>
													<div class="text-sm text-gray-600">
														{#if ev.allDay}
															All day
														{:else}
															{formatLocal(ev.start)} → {formatLocal(ev.end)}
														{/if}
													</div>
												</li>
											{/each}
										</ul>
									{/if}
								</div>

								<!-- Timeline visualization -->
								<div class="md:col-span-2 rounded-lg border p-4 mt-4">
									<div class="flex items-center justify-between mb-3">
										<div class="text-sm font-medium">Day timeline</div>
										<div class="text-xs text-gray-500">Availability (green) + Busy (blue)</div>
									</div>
									<div class="grid grid-cols-[52px_1fr] gap-3">
										<!-- Hour labels -->
										<div class="text-[11px] text-gray-500">
											{#each hours as i}
												<div class="h-10 flex items-start">{pad2(i)}:00</div>
											{/each}
										</div>
										<!-- Timeline track -->
										<div class="relative border rounded-lg overflow-hidden" style="height: 960px;">
											<!-- grid lines -->
											{#each hours as i}
												<div class="absolute left-0 right-0 border-t" style={`top: ${(i / 24) * 100}%`}></div>
											{/each}

											<!-- blocks -->
											{#each timelineBlocks as b}
												<div
													class="absolute left-2 right-2 rounded-lg px-2 py-1 text-[11px] shadow-sm"
													class:bg-emerald-100={b.type === 'avail'}
													class:text-emerald-900={b.type === 'avail'}
													class:bg-blue-100={b.type === 'busy'}
													class:text-blue-900={b.type === 'busy'}
													style={`top:${b.top}%; height:${Math.max(b.height, 1)}%;`}
													title={b.label}
												>
													{b.label}
												</div>
											{/each}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div>
				<div class="rounded border bg-white">
					<div class="p-4 border-b">
						<h2 class="font-medium">Block time</h2>
						<p class="text-sm text-gray-600">Create a block event. Use the same time step as Availability.</p>
					</div>
					<div class="p-4 space-y-3">
						<div>
							<label class="block text-sm text-gray-700 mb-1" for="block-title">Title</label>
							<input id="block-title" class="w-full border rounded px-3 py-2" bind:value={summary} />
						</div>
						<div>
							<label class="block text-sm text-gray-700 mb-1" for="block-date">Date</label>
							<input id="block-date" class="w-full border rounded px-3 py-2" type="date" bind:value={date} />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<label class="block text-sm text-gray-700 mb-1" for="block-start">Start</label>
								<select id="block-start" class="w-full border rounded px-3 py-2 bg-white" bind:value={startTime}>
									{#each times as t}
										<option value={t}>{t}</option>
									{/each}
								</select>
							</div>
							<div>
								<label class="block text-sm text-gray-700 mb-1" for="block-end">End</label>
								<select id="block-end" class="w-full border rounded px-3 py-2 bg-white" bind:value={endTime}>
									{#each times as t}
										<option value={t}>{t}</option>
									{/each}
								</select>
							</div>
						</div>
						<div class="text-xs text-gray-500">
							Tip: pick a day on the calendar to sync the date here.
						</div>
						{#if createError}
							<div class="text-sm text-red-700">{createError}</div>
						{/if}
						<button class="w-full px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60" disabled={creating} onclick={createBlock}>
							{creating ? 'Creating…' : 'Create block'}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- outer page wrapper -->
</div>

<script lang="ts">
	import type { PageData } from './$types';
	import TimezoneSelector from '$lib/components/TimezoneSelector.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { createBrandColors } from '$lib/utils/colorUtils';
	import { detectTimezone, getCurrentTime } from '$lib/constants/timezones';
	import { formatDateLocal, formatSelectedDate } from '$lib/utils/dateFormatters';
	import { BookingCalendar } from '$lib/components/booking';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

	// Language/locale (read from ?lang=ar)
	const urlLang = page.url.searchParams.get('lang') || 'en';
	const lang: 'en' | 'ar' = urlLang.startsWith('ar') ? 'ar' : 'en';
	const locale = lang === 'ar' ? 'ar-EG-u-nu-arab' : 'en-US';

	function weekdayLabel(dateStr: string) {
		const d = new Date(dateStr);
		return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d);
	}

	// Brand colors
	const brandColor = data.booking.brandColor;
	const colors = createBrandColors(brandColor);

	let selectedDate = $state<string | null>(null);
	let selectedSlot = $state<{ start: string; end: string } | null>(null);
	let availableSlots = $state<Array<{ start: string; end: string }>>([]);
	let loading = $state(false);
	let rescheduleStatus = $state<'idle' | 'submitting' | 'success' | 'error'>('idle');
	let rescheduleError = $state('');
	let newMeetingUrl = $state<string | null>(null);

	// Track which dates have available slots
	let availableDates = $state<Set<string>>(new Set());
	let loadingAvailability = $state(false);

	// Timezone state
	let selectedTimezone = $state(detectTimezone());
	let showTimezoneDropdown = $state(false);

	// Calendar state
	let currentMonth = $state(new Date());

	// Date/time formatters
	const use12Hour = data.timeFormat !== '24h';

	function formatTime(isoStr: string) {
		const date = new Date(isoStr);
		return new Intl.DateTimeFormat(locale, {
			hour: 'numeric',
			minute: '2-digit',
			hour12: use12Hour,
			timeZone: selectedTimezone
		}).format(date);
	}

	function formatTimeRange(start: string, end: string) {
		return `${formatTime(start)} - ${formatTime(end)}`;
	}

	function formatOriginalDateTime(dateStr: string) {
		const date = new Date(dateStr);
		return new Intl.DateTimeFormat(locale, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			hour12: use12Hour,
			timeZone: selectedTimezone
		}).format(date);
	}

	function prevMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
		fetchMonthAvailability();
	}

	function nextMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
		fetchMonthAvailability();
	}

	async function fetchMonthAvailability() {
		loadingAvailability = true;

		try {
			const year = currentMonth.getFullYear();
			const month = currentMonth.getMonth() + 1;
			const monthStr = month.toString().padStart(2, '0');

			const res = await fetch(
				`/api/public/reschedule/${data.booking.id}/availability?year=${year}&month=${monthStr}&tz=${encodeURIComponent(
					selectedTimezone
				)}`
			);

			if (!res.ok) throw new Error('Failed to fetch availability');

			const { availableDates: dates } = await res.json();
			availableDates = new Set(dates || []);
		} catch (e: any) {
			console.error('Error fetching availability:', e);
			availableDates = new Set();
		} finally {
			loadingAvailability = false;
		}
	}

	async function fetchSlots(dateStr: string) {
		loading = true;

		try {
			const res = await fetch(
				`/api/public/reschedule/${data.booking.id}/slots?date=${dateStr}&tz=${encodeURIComponent(
					selectedTimezone
				)}`
			);

			if (!res.ok) throw new Error('Failed to fetch slots');

			const { slots } = await res.json();
			availableSlots = slots || [];
		} catch (e: any) {
			console.error('Error fetching slots:', e);
			availableSlots = [];
		} finally {
			loading = false;
		}
	}

	function selectDate(dateStr: string) {
		selectedDate = dateStr;
		selectedSlot = null;
		fetchSlots(dateStr);
	}

	function selectSlot(slot: { start: string; end: string }) {
		selectedSlot = slot;
	}

	async function submitReschedule() {
		if (!selectedDate || !selectedSlot) return;

		rescheduleStatus = 'submitting';
		rescheduleError = '';

		try {
			const res = await fetch(`/api/public/reschedule/${data.booking.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					date: selectedDate,
					start: selectedSlot.start,
					end: selectedSlot.end,
					timeZone: selectedTimezone
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message || 'Reschedule failed');
			}

			const result = await res.json();
			newMeetingUrl = result?.meetingUrl || null;
			rescheduleStatus = 'success';
		} catch (e: any) {
			rescheduleError = e?.message || 'Reschedule failed';
			rescheduleStatus = 'error';
		}
	}

	function toggleTimezoneDropdown() {
		showTimezoneDropdown = !showTimezoneDropdown;
	}

	function closeTimezoneDropdown(e: MouseEvent) {
		const target = e.target as Node | null;
		const dropdown = document.getElementById('tz-dropdown');
		const button = document.getElementById('tz-button');

		if (showTimezoneDropdown) {
			if (dropdown && dropdown.contains(target)) return;
			if (button && button.contains(target)) return;
			showTimezoneDropdown = false;
		}
	}

	// Initialize
	$effect(() => {
		fetchMonthAvailability();
	});

	$effect(() => {
		if (selectedDate) fetchSlots(selectedDate);
	});

	$effect(() => {
		document.addEventListener('click', closeTimezoneDropdown);
		return () => document.removeEventListener('click', closeTimezoneDropdown);
	});
</script>

<svelte:head>
	<title>Reschedule</title>
</svelte:head>

<div class="min-h-screen flex flex-col">
	<main class="flex-1">
		<div class="max-w-5xl mx-auto px-4 py-8">
			<div class="flex items-center justify-between mb-8">
				<h1 class="text-3xl font-bold text-primary">Reschedule</h1>

				<div class="relative">
					<button
						id="tz-button"
						type="button"
						class="flex items-center gap-2 px-3 py-2 border foreground-border rounded-lg text-sm font-semibold"
						onclick={toggleTimezoneDropdown}
					>
						<span class="text-primary">Time zone</span>
						<span class="text-gray-500">{getCurrentTime(selectedTimezone)}</span>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					{#if showTimezoneDropdown}
						<div id="tz-dropdown" class="absolute right-0 mt-2 z-50">
							<TimezoneSelector bind:selectedTimezone />
						</div>
					{/if}
				</div>
			</div>

			<div class="bg-white rounded-2xl shadow p-8">
				<div class="flex gap-8">
					<div class="w-80 flex flex-col gap-4">
						<div class="border rounded-xl p-4">
							<h2 class="text-lg font-semibold text-primary mb-2">Original</h2>
							<p class="text-sm text-gray-700">
								{formatOriginalDateTime(data.booking.start)}
							</p>
						</div>

						{#if rescheduleStatus === 'success'}
							<div class="border rounded-xl p-4 border-green-200 bg-green-50">
								<h2 class="text-lg font-semibold text-green-800 mb-2">Success</h2>
								<p class="text-sm text-green-700">
									Booked {selectedDate ? formatSelectedDate(selectedDate) : ''} {selectedSlot ? formatTimeRange(selectedSlot.start, selectedSlot.end) : ''}
								</p>
								{#if newMeetingUrl}
									<p class="text-sm text-green-700 mt-2">
										<a class="underline" href={newMeetingUrl} target="_blank" rel="noreferrer">Meeting link</a>
									</p>
								{/if}
							</div>
						{:else if rescheduleStatus === 'error'}
							<div class="border rounded-xl p-4 border-red-200 bg-red-50">
								<h2 class="text-lg font-semibold text-red-800 mb-2">Error</h2>
								<p class="text-sm text-red-700">{rescheduleError}</p>
							</div>
						{/if}
					</div>

					<div class="flex-1 flex gap-8">
						<div class="flex flex-col">
							<BookingCalendar
								{currentMonth}
								{brandColor}
								availableDates={availableDates}
								loadingAvailability={loadingAvailability}
								onSelectDate={selectDate}
								onPrevMonth={prevMonth}
								onNextMonth={nextMonth}
							/>
						</div>

						{#if selectedDate}
							<div class="w-52 ml-6 border-l foreground-border pl-6 flex flex-col" style="max-height: 400px;">
								<h3 class="text-sm font-medium text-gray-500 mb-4 flex-shrink-0">
									{weekdayLabel(selectedDate)}
								</h3>
								{#if loading}
									<div class="flex items-center justify-center py-8">
										<div class="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent" style="border-color: {brandColor}; border-top-color: transparent"></div>
									</div>
								{:else if availableSlots.length === 0}
									<p class="text-sm text-gray-500 py-4">No available times</p>
								{:else}
									<div class="space-y-2 overflow-y-auto flex-1 pr-2 pb-2 scrollbar-thin">
										{#each availableSlots as slot}
											{#if selectedSlot === slot}
												<div class="flex gap-2">
													<button type="button" class="flex-1 py-2.5 px-3 border-2 foreground-border background-accent text-primary rounded-lg text-sm font-semibold">
														{formatTime(slot.start)}
													</button>
													<button
														type="button"
														onclick={submitReschedule}
														class="flex-1 py-2.5 px-3 text-white rounded-lg text-sm font-semibold transition"
														style="background-color: var(--foreground-accent, {brandColor})"
													>
														Confirm
													</button>
												</div>
											{:else}
												<button
													type="button"
													onclick={() => selectSlot(slot)}
													class="w-full py-2.5 px-3 border-2 rounded-lg text-sm font-semibold transition"
													style="border-color: var(--foreground-accent, {brandColor}); color: var(--foreground-accent, {brandColor})"
												>
													{formatTime(slot.start)}
												</button>
											{/if}
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</main>

	<Footer />
</div>

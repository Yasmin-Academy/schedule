<script lang="ts">
	import { onMount } from 'svelte';
	import { createBrandColors } from '$lib/utils/colorUtils';
	import { detectTimezone, getTimezoneLabel } from '$lib/constants/timezones';
	import TimezoneSelector from '$lib/components/TimezoneSelector.svelte';
	import { formatSelectedDate } from '$lib/utils/dateFormatters';
	import { BookingCalendar, TimeSlotList, BookingForm, BookingSuccess, EventSidebar } from '$lib/components/booking';

	let { event = '', baseUrl = '', lang = 'en' } = $props<{ event?: string; baseUrl?: string; lang?: string }>();

	let l = $state<'en' | 'ar'>('en');
	let dir = $state<'ltr' | 'rtl'>('ltr');

	let t = $state<Record<string, string>>({});
	const defaults = {
		en: {
			selectDateTime: 'Select a date & time',
			onlineRoom: 'Online Room',
			roomNote: 'Room link and details will be sent by email after booking.'
		},
		ar: {
			selectDateTime: 'اختر التاريخ والوقت',
			onlineRoom: 'غرفة أونلاين',
			roomNote: 'سيتم إرسال رابط الغرفة والتفاصيل عبر البريد الإلكتروني بعد الحجز.'
		}
	} as const;

	const tr = $derived({ ...defaults[l], ...t });

	let loadingCore = $state(true);
	let errorMsg = $state<string | null>(null);

	let host = $state<{ name: string; brandColor: string; timeFormat: '12h' | '24h' } | null>(null);
	let eventType = $state<any>(null);

	const brandColor = $derived(host?.brandColor || '#3b82f6');
	const colors = $derived(createBrandColors(brandColor));
	const use12Hour = $derived((host?.timeFormat || '12h') !== '24h');

	let selectedDate = $state<string | null>(null);
	let selectedSlot = $state<{ start: string; end: string } | null>(null);
	let availableSlots = $state<Array<{ start: string; end: string }>>([]);

	let showForm = $state(false);
	let bookingForm = $state({ name: '', email: '', notes: '' });

	let bookingStatus = $state<'idle' | 'submitting' | 'success' | 'error'>('idle');
	let bookingError = $state('');

	let meetingUrl = $state<string | null>(null);
	let clientStartedAt = $state(Date.now());

	let availableDates = $state<Set<string>>(new Set());
	let loadingAvailability = $state(false);
	let loadingSlots = $state(false);
	let currentMonth = $state(new Date());

	let selectedTimezone = $state(detectTimezone());
	let showTimezoneDropdown = $state(false);

	let tzNowLabel = $state('');
	let tzNowTime = $state('');

	let tzDropdownEl = $state<HTMLDivElement | null>(null);
	let tzButtonEl = $state<HTMLButtonElement | null>(null);

	function ymdInTz(d: Date, tz: string) {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(d);

		const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
		return `${get('year')}-${get('month')}-${get('day')}`;
	}

	function tzDisplayName(tz: string) {
		return getTimezoneLabel(tz, lang);
	}

	function updateTzNow() {
		const now = new Date();

		tzNowLabel = tzDisplayName(selectedTimezone);

		const locale = l === 'ar' ? 'ar-EG-u-nu-arab' : 'en-US';

		tzNowTime = new Intl.DateTimeFormat(locale, {
			timeZone: selectedTimezone,
			hour: 'numeric',
			minute: '2-digit',
			hour12: use12Hour
		}).format(now);
	}

	function closeTimezoneIfOutside(e: Event) {
		if (!showTimezoneDropdown) return;

		const path =
			typeof (e as any).composedPath === 'function'
				? ((e as any).composedPath() as EventTarget[])
				: [];

		if (tzDropdownEl && path.includes(tzDropdownEl)) return;
		if (tzButtonEl && path.includes(tzButtonEl)) return;

		const target = (e as any).target as Node | null;
		if (!target) return;

		if (tzDropdownEl?.contains(target) || tzButtonEl?.contains(target)) return;

		showTimezoneDropdown = false;
	}

	function closeTimezoneOnEsc(e: KeyboardEvent) {
		if (!showTimezoneDropdown) return;
		if (e.key === 'Escape' || e.key === 'Esc') showTimezoneDropdown = false;
	}

	function api(path: string) {
		const b = (baseUrl || '').replace(/\/$/, '');
		return `${b}${path}`;
	}

	function normalizeLang(raw: string) {
		const v = (raw || '').toLowerCase();
		return v.startsWith('ar') ? 'ar' : 'en';
	}

	function formatTime(isoStr: string) {
		const date = new Date(isoStr);

		return new Intl.DateTimeFormat(l === 'ar' ? 'ar' : 'en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: use12Hour,
			timeZone: selectedTimezone
		}).format(date);
	}

	function formatTimeRange(start: string, end: string) {
		return `${formatTime(start)} - ${formatTime(end)}`;
	}

	async function fetchCore() {
		loadingCore = true;
		errorMsg = null;

		try {
			l = normalizeLang(lang);
			dir = l === 'ar' ? 'rtl' : 'ltr';

			if (!event) throw new Error('Missing event slug');
			if (!baseUrl) throw new Error('Missing base-url');

			const res = await fetch(api(`/api/public/event-type/${encodeURIComponent(event)}`));
			if (!res.ok) throw new Error('Failed to load event');

			const data = await res.json();

			host = data.host;
			eventType = data.eventType;
			meetingUrl = data.eventType?.location_details || null;

			const hostTranslations =
				(data.host?.translations && (data.host.translations as any)[lang]) || {};

			t = {
				...(defaults as any)[lang],
				...(hostTranslations || {}),
				...(data.host?.widgetTranslations || {})
			};
		} catch (e: any) {
			errorMsg = e?.message || 'Failed to load';
		} finally {
			loadingCore = false;
		}
	}

	async function fetchMonthAvailability() {
		if (!event) return;

		loadingAvailability = true;

		try {
			const year = currentMonth.getFullYear();
			const monthNum = currentMonth.getMonth() + 1;
			const monthStr = `${year}-${String(monthNum).padStart(2, '0')}`;

			const res = await fetch(
				api(`/api/availability/month?event=${encodeURIComponent(event)}&month=${monthStr}`)
			);
			if (!res.ok) throw new Error();

			const result = await res.json();
			availableDates = new Set(result.availableDates || []);

			if (!selectedDate && availableDates.size > 0) {
				const today = ymdInTz(new Date(), selectedTimezone);
				const sorted = Array.from(availableDates).sort();
				const first = sorted.find((d) => d >= today) || sorted[0];
				await handleDateSelect(first);
			}
		} finally {
			loadingAvailability = false;
		}
	}

	function prevMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
		fetchMonthAvailability();
	}

	function nextMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
		fetchMonthAvailability();
	}

	async function handleDateSelect(dateStr: string) {
		selectedDate = dateStr;
		selectedSlot = null;
		showForm = false;

		loadingSlots = true;

		try {
			const res = await fetch(
				api(`/api/availability?event=${encodeURIComponent(event)}&date=${dateStr}`)
			);
			if (!res.ok) throw new Error();

			const result = await res.json();
			availableSlots = result.slots || [];
		} finally {
			loadingSlots = false;
		}
	}

	async function handleTimezoneSelect(tz: string) {
		selectedTimezone = tz;
		updateTzNow();
		showTimezoneDropdown = false;

		await fetchMonthAvailability();
		if (selectedDate) await handleDateSelect(selectedDate);
	}

	function selectSlot(slot: { start: string; end: string }) {
		selectedSlot = slot;
	}

	function confirmSlot() {
		showForm = true;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!selectedSlot) return;

		bookingStatus = 'submitting';
		bookingError = '';

		try {
			const res = await fetch(api('/api/bookings'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					eventSlug: event,
					startTime: selectedSlot.start,
					endTime: selectedSlot.end,
					attendeeName: bookingForm.name,
					attendeeEmail: bookingForm.email,
					notes: bookingForm.notes,
					company_website: '',
					client_started_at: clientStartedAt,
					timezone: selectedTimezone,
					lang: l
				})
			});

			if (!res.ok) throw new Error();

			bookingStatus = 'success';
		} catch (err: any) {
			bookingStatus = 'error';
			bookingError = err?.message || 'Booking failed';
		}
	}

	onMount(async () => {
		clientStartedAt = Date.now();

		document.addEventListener('mousedown', closeTimezoneIfOutside, true);
		document.addEventListener('touchstart', closeTimezoneIfOutside, true);
		window.addEventListener('keydown', closeTimezoneOnEsc);

		await fetchCore();

		updateTzNow();
		const tick = setInterval(updateTzNow, 60000);

		await fetchMonthAvailability();

		return () => {
			clearInterval(tick);
			document.removeEventListener('mousedown', closeTimezoneIfOutside, true);
			document.removeEventListener('touchstart', closeTimezoneIfOutside, true);
			window.removeEventListener('keydown', closeTimezoneOnEsc);
		};
	});
</script>

<div class="schedule-widget-root w-full" dir={dir} lang={l}>
	{#if loadingCore}
		<div class="p-6 text-sm text-muted">Loading…</div>
	{:else if errorMsg}
		<div class="p-6 text-sm text-red-600">{errorMsg}</div>
	{:else}
		<div
			class="flex flex-col items-center md:justify-center"
			style="--brand-color: var(--foreground-accent);"
		>
			{#if bookingStatus === 'success' && selectedDate && selectedSlot}
				<BookingSuccess
					eventName={eventType?.name}
					{selectedDate}
					{selectedSlot}
					{meetingUrl}
					{brandColor}
					{formatTimeRange}
					{formatSelectedDate}
				/>
			{:else}
				<div class="w-full md:flex widget rounded-2xl overflow-hidden" style="max-width: 920px;">
					<EventSidebar
						user={{ name: host?.name }}
						{eventType}
						{selectedDate}
						{selectedSlot}
						{brandColor}
						{formatTime}
						meetingLabel={tr.onlineRoom}
						meetingNote={tr.roomNote}
					/>

					<div class="flex-1 p-6">
						{#if showForm}
							<BookingForm
								{bookingForm}
								{bookingStatus}
								{bookingError}
								{brandColor}
								onSubmit={handleSubmit}
							/>
						{:else}
							<div class="flex">
								<div class="w-80">
									<h2 class="text-xl font-semibold mb-6">
										{l === 'ar' ? 'اختر تاريخًا' : 'Select a date'}
									</h2>

									<BookingCalendar
										{currentMonth}
										{selectedDate}
										{availableDates}
										{brandColor}
										brandLighter={colors.lighter}
										brandDark={colors.dark}
										lang={l}
										onDateSelect={handleDateSelect}
										onPrevMonth={prevMonth}
										onNextMonth={nextMonth}
									/>

									<!-- Timezone selector (matches booking page placement) -->
									<div class="mt-6 relative">
										<p class="text-sm font-semibold text-primary mb-2">
											{l === 'ar' ? 'المنطقة الزمنية' : 'Timezone'}
										</p>

										<button
											bind:this={tzButtonEl}
											type="button"
											onclick={() => (showTimezoneDropdown = !showTimezoneDropdown)}
											class="flex items-center gap-2 text-sm text-muted hover:text-primary transition"
										>
											<svg class="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											</svg>

											<span>{tzNowLabel} · {tzNowTime}</span>

											<svg class="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
											</svg>
										</button>

										{#if showTimezoneDropdown}
											<div bind:this={tzDropdownEl}>
												<TimezoneSelector
													{selectedTimezone}
													lang={l}
													{brandColor}
													onSelect={(tz) => handleTimezoneSelect(tz)}
													onClose={() => (showTimezoneDropdown = false)}
												/>
											</div>
										{/if}
									</div>
								</div>

								{#if selectedDate}
									<TimeSlotList
										{selectedDate}
										availableSlots={availableSlots}
										{selectedSlot}
										loading={loadingSlots}
										{brandColor}
										{formatTime}
										onSelectSlot={selectSlot}
										onConfirm={confirmSlot}
									/>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

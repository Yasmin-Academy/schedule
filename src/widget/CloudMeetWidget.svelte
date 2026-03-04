<script lang="ts">
	import { onMount } from 'svelte';
	import { createBrandColors } from '$lib/utils/colorUtils';
	import { detectTimezone, getTimezoneLabel } from '$lib/constants/timezones';
	import TimezoneSelector from '$lib/components/TimezoneSelector.svelte';
	import { formatSelectedDate } from '$lib/utils/dateFormatters';
	import { BookingCalendar, TimeSlotList, BookingForm, BookingSuccess, EventSidebar } from '$lib/components/booking';

	// Props (Svelte 5 / runes mode)
	let { event = '', baseUrl = '', lang = 'en' } = $props<{ event?: string; baseUrl?: string; lang?: string }>();

	let l = $state<'en' | 'ar'>('en');
	let dir = $state<'ltr' | 'rtl'>('ltr');

	// Optional custom translations returned by the host profile (dashboard).
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
	// Element refs are assigned via bind:this; in runes mode use $state so assignments are tracked.
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
		// Prefer curated labels (with Arabic translations) when available.
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

		// Prefer composedPath() so this works even if an embedding host uses Shadow DOM.
		const path = typeof (e as any).composedPath === 'function' ? ((e as any).composedPath() as EventTarget[]) : [];
		if (tzDropdownEl && path.includes(tzDropdownEl)) return;
		if (tzButtonEl && path.includes(tzButtonEl)) return;

		const target = (e as any).target as Node | null;
		if (!target) return;
		if (tzDropdownEl?.contains(target) || tzButtonEl?.contains(target)) return;
		showTimezoneDropdown = false;
	}

	function closeTimezoneOnEsc(e: KeyboardEvent) {
		if (!showTimezoneDropdown) return;
		if (e.key === 'Escape' || e.key === 'Esc') {
			showTimezoneDropdown = false;
		}
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
			const hostTranslations = (data.host?.translations && (data.host.translations as any)[lang]) || {};
			// Merge order (lowest -> highest): built-in defaults, dashboard translations, widget-specific overrides
			t = { ...(defaults as any)[lang], ...(hostTranslations || {}), ...(data.host?.widgetTranslations || {}) };
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
			const res = await fetch(api(`/api/availability/month?event=${encodeURIComponent(event)}&month=${monthStr}`));
			if (!res.ok) throw new Error('Failed to fetch month availability');
			const result = await res.json();
			availableDates = new Set(result.availableDates || []);

			// Match the /[slug] page feel: auto-select the first available day.
			if (!selectedDate && availableDates.size > 0) {
				const today = ymdInTz(new Date(), selectedTimezone);
				const sorted = Array.from(availableDates).sort();
				const first = sorted.find((d) => d >= today) || sorted[0];
				await handleDateSelect(first);
			}
		} catch {
			availableDates = new Set();
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
			const res = await fetch(api(`/api/availability?event=${encodeURIComponent(event)}&date=${dateStr}`));
			if (!res.ok) throw new Error('Failed to fetch availability');
			const result = await res.json();
			availableSlots = result.slots || [];

			// If month-level availability marked this date as having slots but the
			// day-level endpoint returns none (often happens near timezone boundaries),
			// drop it from the indicator set so we don't show a misleading dot.
			if (availableSlots.length === 0 && availableDates?.has(dateStr)) {
				const next = new Set(availableDates);
				next.delete(dateStr);
				availableDates = next;
			}
		} catch {
			availableSlots = [];
		} finally {
			loadingSlots = false;
		}
	}

	async function handleTimezoneSelect(tz: string) {
		selectedTimezone = tz;
		updateTzNow();
		showTimezoneDropdown = false;
		await fetchMonthAvailability();
		if (selectedDate) {
			await handleDateSelect(selectedDate);
		}
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
					// lightweight anti-abuse fields (paired with Cloudflare WAF rate limiting)
					company_website: '',
					client_started_at: clientStartedAt,
					timezone: selectedTimezone,
					lang: l
				})
			});
			if (!res.ok) {
				const msg = await res.text().catch(() => '');
				throw new Error(msg || 'Booking failed');
			}
			bookingStatus = 'success';
		} catch (err: any) {
			bookingStatus = 'error';
			bookingError = err?.message || 'Booking failed';
		}
	}

	onMount(async () => {
		clientStartedAt = Date.now();
		// Capture-phase outside interaction handling.
		// Use document (more reliable for embeddable widgets) so host scripts can't easily interfere.
		document.addEventListener('mousedown', closeTimezoneIfOutside, true);
		document.addEventListener('touchstart', closeTimezoneIfOutside, true);
		window.addEventListener('keydown', closeTimezoneOnEsc);
		await fetchCore();
		updateTzNow();
		const tick = setInterval(updateTzNow, 60_000);
		await fetchMonthAvailability();

		return () => {
			clearInterval(tick);
			document.removeEventListener('mousedown', closeTimezoneIfOutside, true);
			document.removeEventListener('touchstart', closeTimezoneIfOutside, true);
			window.removeEventListener('keydown', closeTimezoneOnEsc);
		};
	});
</script>

<div class="schedule-widget-root w-full" {dir} lang={l}>
	{#if loadingCore}
		<div class="p-6 text-sm text-gray-600">Loading…</div>
	{:else if errorMsg}
		<div class="p-6 text-sm text-red-600">{errorMsg}</div>
	{:else}
	{#if bookingStatus === 'success'}
		<!-- Success Screen -->
		<BookingSuccess
			lang={lang}
			tr={tr}
			eventName={(lang === 'ar' && data.eventType?.name_ar) ? data.eventType.name_ar : (data.eventType?.name || t('meetingLabel','Meeting'))}
			{selectedDate}
			{selectedSlot}
			{meetingUrl}
			{brandColor}
			{formatTimeRange}
			{formatSelectedDate}
		/>
		<Footer class="mt-6" />
	{:else}
		<!-- MOBILE LAYOUT (< 768px) - Full white page -->
		<div class="md:hidden min-h-screen w-full bg-white">
			<!-- Cover Image with black line below -->
			{#if data.eventType?.cover_image}
				<div class="px-6 pt-6 flex justify-center">
					<img src={data.eventType.cover_image} alt="" class="max-h-16 w-auto object-contain" />
				</div>
				<div class="border-b border-gray-200 mx-6 mt-4"></div>
			{/if}

			<!-- Back button for non-calendar steps -->
			{#if mobileStep !== 'calendar'}
				<div class="px-6 py-4">
					<button
						onclick={goBackMobile}
						class="flex items-center gap-2 text-gray-600 hover:text-gray-900"
						aria-label={t('back', 'Back')}
					>
						<svg class="w-5 h-5 rtl-flip" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
						</svg>
						<span class="text-sm">{t('back', 'Back')}</span>
					</button>
				</div>
			{/if}

			<!-- Profile Image centered with name below -->
			{#if mobileStep === 'calendar'}
				<div class="flex flex-col items-center pt-8 pb-6 px-6">
					{#if data.user?.profileImage}
						<img src={data.user.profileImage} alt={data.user.name} class="w-24 h-24 rounded-full object-cover border-4 border-white shadow-lg" />
					{:else}
						<div class="w-24 h-24 rounded-full flex items-center justify-center text-white font-semibold text-3xl border-4 border-white shadow-lg" style="background-color: var(--brand-color)">
							{data.user?.name?.charAt(0) || 'M'}
						</div>
					{/if}
					<p class="mt-4 text-base font-semibold text-gray-600">{data.eventType?.host_name_ar && lang === 'ar' ? data.eventType.host_name_ar : (data.user?.name || t('hostLabel', 'Host'))}</p>
				</div>

				<!-- Meeting Title -->
				<div class="px-6 pb-5">
					<h1 class="text-2xl font-bold text-gray-900 text-center">{data.eventType?.name_ar && lang === 'ar' ? data.eventType.name_ar : (data.eventType?.name || t('meetingLabel', 'Meeting'))}</h1>
				</div>

				<!-- Meeting Details List -->
				<div class="px-6 pb-5">
					<ul class="space-y-3 text-sm text-gray-600">
						<li class="flex items-center gap-3">
							<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
							</svg>
							<span>{data.eventType ? minutesLabel(data.eventType.duration) : ''}</span>
						</li>
						<li class="flex items-center gap-3">
							<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
							</svg>
							<span>{data.eventType?.invite_calendar === 'outlook' ? t('msTeams', 'Microsoft Teams') : t('googleMeet', 'Google Meet')}</span>
						</li>
						<li class="flex items-center gap-3">
							<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
							</svg>
							<button
								type="button"
								onclick={() => showTimezoneDropdown = !showTimezoneDropdown}
								class="flex items-center gap-1 hover:text-gray-900 transition"
							>
									<span>{getTimezoneWithTimeLocalized(selectedTimezone, use12Hour, locale, lang === 'ar' ? 'ar' : 'en')}</span>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
								</svg>
							</button>
						</li>
					</ul>
					{#if showTimezoneDropdown}
						<div class="mt-2">
							<TimezoneSelector
								{selectedTimezone}
								onSelect={(tz) => {
								selectedTimezone = tz;
								fetchMonthAvailability(currentMonth);
								if (selectedDate) handleDateSelect(formatDateLocal(selectedDate));
							}}
								onClose={() => showTimezoneDropdown = false}
								{brandColor}
								lang={lang}
							/>
						</div>
					{/if}
				</div>

				<!-- Description -->
				{#if data.eventType?.description}
					<div class="px-6 pb-5 text-sm text-gray-600 prose prose-sm max-w-none">
						{@html sanitizedDescription}
					</div>
				{/if}

				<!-- Breakline / Divider -->
				<div class="border-b border-gray-200 mx-6 mb-6"></div>

				<!-- Calendar with arrows around month name -->
				<div class="px-6 pb-8">
									<h2 class="text-lg font-semibold text-gray-900 mb-5 text-center">{t('selectDate', 'Select a date')}</h2>

					<!-- Month navigation with arrows on sides -->
					<div class="flex items-center justify-between mb-4">
						<button onclick={prevMonth} class="p-2 hover:bg-gray-100 rounded-full transition" aria-label={t('previousMonth', 'Previous month')}>
							<svg class="w-5 h-5 text-gray-600 rtl-flip" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
							</svg>
						</button>
						<h3 class="text-base font-semibold text-gray-900">{formatMonthYear(currentMonth)}</h3>
						<button onclick={nextMonth} class="p-2 hover:bg-gray-100 rounded-full transition" aria-label={t('nextMonth', 'Next month')}>
							<svg class="w-5 h-5 text-gray-600 rtl-flip" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
							</svg>
						</button>
					</div>

					<!-- Weekday headers -->
					<div class="grid grid-cols-7 gap-1 mb-2">
					{#each weekDays() as day}
							<div class="text-center text-xs font-medium text-gray-500 py-2">{day}</div>
						{/each}
					</div>

					<!-- Calendar grid -->
					<div class="grid grid-cols-7 gap-1">
						{#each calendarDays() as day}
							{@const hasSlots = availableDates.has(day.dateStr)}
							{@const isClickable = day.isAvailable && hasSlots}
							{@const isSelected = selectedDate === day.dateStr}
							<button
								type="button"
								onclick={() => isClickable && handleDateSelect(day.dateStr)}
								disabled={!isClickable}
								class="aspect-square flex items-center justify-center text-sm rounded-full transition
									{!day.isCurrentMonth ? 'text-gray-300' : ''}
									{isClickable && !isSelected ? 'font-semibold' : ''}
									{day.isAvailable && !hasSlots && day.isCurrentMonth ? 'text-gray-400' : ''}
									{!day.isAvailable && day.isCurrentMonth ? 'text-gray-300' : ''}
									{isSelected ? 'text-white' : ''}"
								style="{isClickable && !isSelected ? `background-color: var(--brand-lighter); color: var(--brand-dark)` : ''}{isSelected ? `background-color: var(--brand-color)` : ''}"
							>
												{nf.format(day.date.getDate())}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Mobile Time Slots -->
			{#if mobileStep === 'times'}
			<div class="px-6 pb-8">
				<h2 class="text-lg font-semibold text-gray-900 mb-2 text-center">{t('selectTime', 'Select a time')}</h2>
				<p class="text-sm text-gray-500 text-center mb-6">{selectedDate ? formatSelectedDate(selectedDate, locale) : ''}</p>
					{#if loading}
						<div class="flex items-center justify-center py-8">
							<div class="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent" style="border-color: var(--brand-color); border-top-color: transparent;"></div>
						</div>
			{:else if availableSlots.length === 0}
				<p class="text-sm text-gray-500 py-4 text-center">{t('noAvailableTimes', 'No available times for this date')}</p>
					{:else}
						<div class="grid grid-cols-2 gap-3">
							{#each availableSlots as slot}
								{@const isSelected = selectedSlot === slot}
								<button
									type="button"
									onclick={() => selectSlot(slot)}
									class="py-3 px-4 border-2 rounded-lg text-sm font-semibold transition
										{isSelected ? 'border-gray-900 bg-gray-900 text-white' : ''}"
									style="{!isSelected ? `border-color: var(--brand-color); color: var(--brand-color)` : ''}"
								>
									{formatTime(slot.start)}
								</button>
							{/each}
						</div>
						{#if selectedSlot}
							<button
								type="button"
								onclick={confirmSlot}
								class="w-full mt-6 py-3 px-6 text-white rounded-full font-semibold transition"
								style="background-color: var(--brand-color)"
							>
								{t('next', 'Next')}
							</button>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- Mobile Booking Form -->
			{#if mobileStep === 'form'}
				<div class="px-6 pb-8">
					{#if bookingError}
						<div class="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-4 text-sm">
							{bookingError}
						</div>
					{/if}
				<h2 class="text-lg font-semibold text-gray-900 mb-2 text-center">{t('stepEnterDetails', 'Enter details')}</h2>
				<p class="text-sm text-gray-500 text-center mb-6">
					{selectedDate ? formatShortDate(selectedDate) : ''}{selectedSlot ? ` ${t('at', 'at')} ${formatTime(selectedSlot.start)}` : ''}
				</p>
					<form onsubmit={handleSubmit} class="space-y-4">
						<div>
						<label for="mobile-name" class="block text-sm font-medium text-gray-700 mb-1.5">{t('yourName', 'Name')} *</label>
							<input
								type="text"
								id="mobile-name"
								bind:value={bookingForm.name}
								required
								class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none text-sm"
								style="--tw-ring-color: var(--brand-color)"
							/>
						</div>
						<div>
						<label for="mobile-email" class="block text-sm font-medium text-gray-700 mb-1.5">{t('yourEmail', 'Email')} *</label>
							<input
								type="email"
								id="mobile-email"
								bind:value={bookingForm.email}
								required
								class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none text-sm"
								style="--tw-ring-color: var(--brand-color)"
							/>
						</div>
						<div>
							<label for="mobile-notes" class="block text-sm font-medium text-gray-700 mb-1.5">
								{t('additionalNotes', 'Additional notes')}
							</label>
							<textarea
								id="mobile-notes"
								bind:value={bookingForm.notes}
								rows="4"
								class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none resize-none text-sm"
								style="--tw-ring-color: var(--brand-color)"
							></textarea>
						</div>
						<button
							type="submit"
							disabled={bookingStatus === 'submitting'}
							class="w-full text-white py-3 px-6 rounded-full font-semibold transition disabled:opacity-50"
							style="background-color: var(--brand-color)"
						>
							{bookingStatus === 'submitting'
								? t('scheduling', 'Scheduling...')
								: t('scheduleEvent', 'Schedule Event')}
						</button>
					</form>
				</div>
			{/if}

			<!-- Mobile Footer -->
			<Footer class="px-6 pb-8" />
		</div>

		<!-- DESKTOP LAYOUT (>= 768px) -->
		<div class="hidden md:flex bg-white rounded-2xl shadow-lg overflow-hidden transition-all duration-300 ease-in-out" style="width: {showForm ? '700px' : selectedDate ? '920px' : '650px'}">
			<!-- Left Sidebar -->
				<EventSidebar
				user={data.user}
				eventType={data.eventType}
				{selectedDate}
				{selectedSlot}
					lang={lang}
				{brandColor}
				{formatTime}
					tr={tr}
			/>

			<!-- Main Content -->
			<div class="flex-1 p-6">
				{#if bookingError}
					<div class="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6 max-w-2xl">
						{bookingError}
					</div>
				{/if}

				{#if showForm}
					<BookingForm
						lang={lang}
						tr={tr}
						bind:bookingForm
						{bookingStatus}
						{bookingError}
						{brandColor}
						brandDark={colors.dark}
						onSubmit={handleSubmit}
					/>
				{:else}
					<div class="flex items-stretch">
						<div class="w-80">
							<h2 class="text-xl font-semibold text-gray-900 mb-6">{t('selectDate', 'Select a date')}</h2>

							<BookingCalendar
								{currentMonth}
								{selectedDate}
								{availableDates}
								{brandColor}
								lang={lang}
								brandLighter={colors.lighter}
								brandDark={colors.dark}
								onDateSelect={handleDateSelect}
								onPrevMonth={prevMonth}
								onNextMonth={nextMonth}
							/>

							<div class="mt-6 relative">
								<p class="text-sm font-semibold text-gray-900 mb-2">{t('timezone', 'Time zone')}</p>
								<button
									type="button"
									onclick={() => showTimezoneDropdown = !showTimezoneDropdown}
									class="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition"
								>
									<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
									</svg>
									<span>{getTimezoneWithTimeLocalized(selectedTimezone, use12Hour, locale, lang === 'ar' ? 'ar' : 'en')}</span>
									<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
									</svg>
								</button>
								{#if showTimezoneDropdown}
									<TimezoneSelector
										{selectedTimezone}
										lang={lang}
									onSelect={(tz) => {
									selectedTimezone = tz;
									fetchMonthAvailability(currentMonth);
									if (selectedDate) handleDateSelect(formatDateLocal(selectedDate));
								}}
										onClose={() => showTimezoneDropdown = false}
										{brandColor}
									/>
								{/if}
							</div>
						</div>

						{#if selectedDate}
							<TimeSlotList
								lang={lang}
								tr={tr}
								{selectedDate}
								{availableSlots}
								{selectedSlot}
								{loading}
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

		<Footer class="mt-6" />
	{/if}
		</div>
	{/if}
</div>
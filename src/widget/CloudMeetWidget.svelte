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
			<div class="min-h-[520px] widget rounded-xl shadow-sm border overflow-hidden">
			<div class="flex flex-col md:flex-row">
					<EventSidebar
						user={{ name: host?.name }}
						eventType={{
							name: eventType?.name,
							duration: eventType?.duration,
							description: eventType?.description,
							cover_image: eventType?.cover_image_url || null,
							invite_calendar: null
						}}
						selectedDate={selectedDate}
						selectedSlot={selectedSlot}
						brandColor={brandColor}
						formatTime={formatTime}
						meetingLabel={tr.onlineRoom}
						meetingNote={tr.roomNote}
					/>

<div class="flex-1 p-6">				<div class="flex items-stretch"></div>
					<div class="flex items-center justify-between mb-4">
					<h2 class="text-lg font-semibold text-gray-900">{tr.selectDateTime}</h2>
					</div>

					{#if bookingStatus === 'success' && selectedDate && selectedSlot}
						<BookingSuccess
							eventName={eventType?.name}
							selectedDate={selectedDate}
							selectedSlot={selectedSlot}
							meetingUrl={meetingUrl}
							brandColor={brandColor}
							formatTimeRange={formatTimeRange}
							formatSelectedDate={formatSelectedDate}
						/>
					{:else if showForm}
						<div class="flex flex-col gap-4">
							<button type="button" class="text-sm text-gray-600 hover:text-gray-900" onclick={() => (showForm = false)}>
								← Back
							</button>
							<BookingForm
								bookingForm={bookingForm}
								bookingStatus={bookingStatus}
								bookingError={bookingError}
								brandColor={brandColor}
								brandDark={colors.dark}
								onSubmit={handleSubmit}
							/>
						</div>
					{:else}
						<div class="flex flex-col md:flex-row">
							<BookingCalendar
								currentMonth={currentMonth}
								selectedDate={selectedDate}
								availableDates={availableDates}
								brandColor={brandColor}
								brandLighter={colors.lighter}
								brandDark={colors.dark}
								onPrevMonth={prevMonth}
								onNextMonth={nextMonth}
								onDateSelect={handleDateSelect}
								lang={l}
							/>

							{#if selectedDate}
								<TimeSlotList
									selectedDate={selectedDate}
									availableSlots={availableSlots}
									selectedSlot={selectedSlot}
									loading={loadingSlots}
									brandColor={brandColor}
									formatTime={formatTime}
									onSelectSlot={selectSlot}
									onConfirm={confirmSlot}
								/>
							{/if}
						</div>

						<!-- Timezone control -->
					<div class="mt-4 flex items-center justify-center text-sm text-gray-600">
						<div class="flex items-center gap-2">
								<!-- globe icon -->
								<svg
									class="h-4 w-4 text-gray-400"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<circle cx="12" cy="12" r="10" />
									<path d="M2 12h20" />
									<path d="M12 2a15 15 0 0 1 0 20" />
									<path d="M12 2a15 15 0 0 0 0 20" />
								</svg>
								<div class="relative" bind:this={tzDropdownEl}>
									<button
										type="button"
										class="inline-flex items-center gap-2 hover:text-gray-900"
										bind:this={tzButtonEl}
										onclick={() => (showTimezoneDropdown = !showTimezoneDropdown)}
									>
										<span>{tzNowLabel} ({tzNowTime})</span>
										<!-- chevron-down icon -->
										<svg
											class="h-4 w-4 text-gray-400"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
										>
											<path d="M6 9l6 6 6-6" />
										</svg>
									</button>
									{#if showTimezoneDropdown}
										<!-- Backdrop to guarantee outside-click closes in embeds -->
										<div
											class="fixed inset-0 z-40"
											onmousedown={() => (showTimezoneDropdown = false)}
											ontouchstart={() => (showTimezoneDropdown = false)}
										></div>
										<div class="absolute left-0 bottom-full mb-2 z-50">
											<TimezoneSelector
												selectedTimezone={selectedTimezone}
												onSelect={handleTimezoneSelect}
												onClose={() => (showTimezoneDropdown = false)}
												brandColor={brandColor}
												lang={l}
											/>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
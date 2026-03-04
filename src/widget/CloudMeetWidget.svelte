<script lang="ts">
	import { onMount } from 'svelte';
	import { createBrandColors } from '$lib/utils/colorUtils';
	import { detectTimezone, getTimezoneLabel } from '$lib/constants/timezones';
	import TimezoneSelector from '$lib/components/TimezoneSelector.svelte';
	import { formatSelectedDate } from '$lib/utils/dateFormatters';
	import { BookingCalendar, TimeSlotList, BookingForm, BookingSuccess, EventSidebar } from '$lib/components/booking';

	let { event = '', baseUrl = '', lang = 'en' } = $props();

	interface BookingType {
		id: string;
		name: string;
		name_ar?: string;
		duration: number;
		description?: string;
		description_ar?: string;
	}

	interface BookingSlot {
		start: string;
		end: string;
	}

	interface BookingHost {
		name: string;
		email?: string;
		avatar?: string;
		translations?: Record<string, Record<string, string>>;
		widgetTranslations?: Record<string, string>;
	}

	interface BookingData {
		eventType: BookingType;
		host: BookingHost;
		timeFormat?: '12h' | '24h';
		brandColor?: string;
	}

	const defaults: Record<string, Record<string, string>> = {
		en: {
			next: 'Next',
			noAvailableTimes: 'No available times',
			selectDate: 'Select a date',
			timeZone: 'Time zone',
			room: 'Online room',
			roomNote: 'The room link and details will be sent by email after booking.',
			booked: 'Booked',
			backToCalendar: 'Back to calendar',
			addToCalendar: 'Add to calendar',
			copyLink: 'Copy link',
			linkCopied: 'Link copied',
			meetingLink: 'Meeting link',
			original: 'Original',
			reschedule: 'Reschedule',
			cancel: 'Cancel',
			confirm: 'Confirm',
			submitting: 'Submitting...',
			error: 'Something went wrong',
			success: 'Success',
			loading: 'Loading...'
		},
		ar: {
			next: 'التالي',
			noAvailableTimes: 'لا توجد أوقات متاحة',
			selectDate: 'اختر تاريخاً',
			timeZone: 'المنطقة الزمنية',
			room: 'غرفة أونلاين',
			roomNote: 'سيتم إرسال رابط الغرفة والتفاصيل عبر البريد الإلكتروني بعد الحجز.',
			booked: 'تم الحجز',
			backToCalendar: 'العودة للتقويم',
			addToCalendar: 'إضافة إلى التقويم',
			copyLink: 'نسخ الرابط',
			linkCopied: 'تم نسخ الرابط',
			meetingLink: 'رابط الاجتماع',
			original: 'الأصلي',
			reschedule: 'إعادة الجدولة',
			cancel: 'إلغاء',
			confirm: 'تأكيد',
			submitting: 'جارٍ الإرسال...',
			error: 'حدث خطأ ما',
			success: 'تم بنجاح',
			loading: 'جارٍ التحميل...'
		}
	};

	function normalizeLang(l: string) {
		return (l || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
	}

	let l = $derived(normalizeLang(lang));

	let bookingData = $state<BookingData | null>(null);
	let eventType = $state<BookingType | null>(null);
	let host = $state<BookingHost | null>(null);

	let loading = $state(true);
	let error = $state('');

	let selectedDate = $state<string | null>(null);
	let selectedSlot = $state<BookingSlot | null>(null);
	let availableSlots = $state<BookingSlot[]>([]);
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
		const y = parts.find((p) => p.type === 'year')?.value || '1970';
		const m = parts.find((p) => p.type === 'month')?.value || '01';
		const day = parts.find((p) => p.type === 'day')?.value || '01';
		return `${y}-${m}-${day}`;
	}

	function updateTzNow() {
		try {
			const tz = selectedTimezone || detectTimezone();
			const label = getTimezoneLabel(tz, l);

			const locale = l === 'ar' ? 'ar-EG-u-nu-arab' : 'en-US';

			const now = new Date();
			const nowStr = new Intl.DateTimeFormat(locale, {
				hour: 'numeric',
				minute: '2-digit',
				hour12: use12Hour,
				timeZone: tz
			}).format(now);

			tzNowLabel = label;
			tzNowTime = nowStr;
		} catch {
			// ignore
		}
	}

	let use12Hour = $derived(bookingData?.timeFormat !== '24h');

	const brandColor = $derived(bookingData?.brandColor || '#B78E39');
	const colors = $derived(createBrandColors(brandColor));

	let t = $derived(() => {
		const hostTranslations = (host?.translations as any)?.[l] || {};
		return {
			...(defaults as any)[l],
			...(hostTranslations || {}),
			...(host?.widgetTranslations || {})
		};
	});

	const tr = $derived({ ...defaults[l], ...t });

	const locale = l === 'ar' ? 'ar-EG-u-nu-arab' : 'en-US';

	function tzDisplayName(tz: string) {
		return getTimezoneLabel(tz, l);
	}

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

	function prevMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
	}

	function nextMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
	}

	async function fetchBookingData() {
		loading = true;
		error = '';

		try {
			const res = await fetch(`${baseUrl}/api/public/event/${event}?lang=${l}`);
			if (!res.ok) throw new Error('Failed to fetch booking data');

			const data = (await res.json()) as BookingData;
			bookingData = data;
			eventType = data.eventType;
			host = data.host;
		} catch (e: any) {
			error = e?.message || 'Failed to load';
		} finally {
			loading = false;
		}
	}

	async function fetchSlots(dateStr: string) {
		loadingSlots = true;

		try {
			const res = await fetch(
				`${baseUrl}/api/public/slots/${event}?date=${dateStr}&tz=${encodeURIComponent(
					selectedTimezone
				)}`
			);
			if (!res.ok) throw new Error('Failed to fetch slots');

			const data = (await res.json()) as { slots: BookingSlot[] };
			availableSlots = data.slots || [];
		} catch {
			availableSlots = [];
		} finally {
			loadingSlots = false;
		}
	}

	function selectDate(dateStr: string) {
		selectedDate = dateStr;
		selectedSlot = null;
		fetchSlots(dateStr);
	}

	function selectSlot(slot: BookingSlot) {
		selectedSlot = slot;
	}

	function confirmSlot() {
		// noop - BookingForm step
	}

	let bookingForm = $state({
		name: '',
		email: '',
		notes: ''
	});

	let bookingStatus = $state<'idle' | 'submitting' | 'success' | 'error'>('idle');
	let bookingError = $state('');
	let meetingUrl = $state<string | null>(null);

	async function handleSubmit(payload: { name: string; email: string; notes?: string }) {
		bookingStatus = 'submitting';
		bookingError = '';

		try {
			const res = await fetch(`${baseUrl}/api/public/book/${event}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...payload,
					date: selectedDate,
					start: selectedSlot?.start,
					end: selectedSlot?.end,
					timeZone: selectedTimezone,
					lang: l
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message || 'Booking failed');
			}

			const data = (await res.json()) as { meetingUrl?: string };
			meetingUrl = data.meetingUrl || null;
			bookingStatus = 'success';
		} catch (e: any) {
			bookingError = e?.message || 'Booking failed';
			bookingStatus = 'error';
		}
	}

	function closeTimezoneDropdown(e: MouseEvent) {
		const target = e.target as Node | null;

		if (showTimezoneDropdown) {
			if (tzDropdownEl && tzDropdownEl.contains(target)) return;
			if (tzButtonEl && tzButtonEl.contains(target)) return;
			showTimezoneDropdown = false;
		}
	}

	onMount(() => {
		fetchBookingData();
		updateTzNow();
		const id = setInterval(updateTzNow, 30_000);
		document.addEventListener('click', closeTimezoneDropdown);

		return () => {
			clearInterval(id);
			document.removeEventListener('click', closeTimezoneDropdown);
		};
	});

	$: if (selectedDate) {
		fetchSlots(selectedDate);
	}
</script>

{#if loading}
	<div class="w-full flex items-center justify-center py-16">
		<div class="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent" style="border-color: {brandColor}; border-top-color: transparent"></div>
	</div>
{:else if error}
	<div class="w-full text-center py-16 text-red-500">{error}</div>
{:else if bookingStatus === 'success'}
	<BookingSuccess
		lang={l}
		tr={tr}
		eventName={l === 'ar' && eventType?.name_ar ? eventType.name_ar : eventType?.name}
		{selectedDate}
		selectedSlot={selectedSlot}
		{meetingUrl}
		{brandColor}
		{formatTimeRange}
		formatSelectedDate={(d) => formatSelectedDate(d, locale)}
	/>
{:else}
	<div class="flex flex-col gap-6">
		<div class="flex justify-between items-start gap-4">
			<div class="flex items-center gap-3">
				<div class="flex flex-col">
					<h1 class="text-2xl font-bold text-primary">
						{l === 'ar' && eventType?.name_ar ? eventType.name_ar : eventType?.name}
					</h1>
				</div>
			</div>

			<div class="relative">
				<button
					bind:this={tzButtonEl}
					type="button"
					class="flex items-center gap-2 px-3 py-2 border foreground-border rounded-lg text-sm font-semibold"
					onclick={() => (showTimezoneDropdown = !showTimezoneDropdown)}
				>
					<span class="text-primary">{tr.timeZone}</span>
					<span class="text-gray-500">{tzNowLabel}</span>
					<span class="text-gray-500">{tzNowTime}</span>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>

				{#if showTimezoneDropdown}
					<div bind:this={tzDropdownEl} class="absolute right-0 mt-2 z-50">
						<TimezoneSelector bind:selectedTimezone onSelect={() => (showTimezoneDropdown = false)} getTimezoneLabel={tzDisplayName} lang={l} />
					</div>
				{/if}
			</div>
		</div>

		<div class="flex gap-6">
			<EventSidebar
				lang={l}
				tr={tr}
				user={{ name: host?.name }}
				{eventType}
				{selectedDate}
				{selectedSlot}
				{brandColor}
				{formatTime}
				meetingLabel={tr.room}
				meetingNote={tr.roomNote}
			/>

			<div class="flex-1 flex gap-6">
				<div class="flex flex-col">
					<BookingCalendar
						lang={l}
						tr={tr}
						{currentMonth}
						{brandColor}
						onSelectDate={selectDate}
						onPrevMonth={prevMonth}
						onNextMonth={nextMonth}
					/>
				</div>

				{#if selectedDate}
					<TimeSlotList
						lang={l}
						tr={tr}
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
		</div>

		{#if selectedSlot}
			<div class="mt-2">
				<BookingForm
					lang={l}
					tr={tr}
					{bookingForm}
					{bookingStatus}
					{bookingError}
					{brandColor}
					brandDark={colors.dark}
					onSubmit={handleSubmit}
				/>
			</div>
		{/if}
	</div>
{/if}

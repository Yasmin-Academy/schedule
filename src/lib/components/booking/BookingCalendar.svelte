<script lang="ts">
	import { formatDateLocal } from '$lib/utils/dateFormatters';

	interface Props {
		currentMonth: Date;
		selectedDate: string | null;
		availableDates: Set<string>;
		brandColor: string;
		brandLighter: string;
		brandDark: string;
		lang?: string;
		onDateSelect: (dateStr: string) => void;
		onPrevMonth: () => void;
		onNextMonth: () => void;
	}

	let {
		currentMonth,
		selectedDate,
		availableDates,
		brandColor,
		brandLighter,
		brandDark,
		lang = 'en',
		onDateSelect,
		onPrevMonth,
		onNextMonth
	}: Props = $props();

	// Force Arabic-Indic digits when Arabic UI is requested.
  // In Svelte 5 runes mode, $derived returns a reactive getter.
  // Use locale() / nf() when reading their values.
  const locale = $derived(() => (lang === 'ar' ? 'ar-EG-u-nu-arab' : 'en-US'));
  const nf = $derived(() => new Intl.NumberFormat(locale()));

	const weekDays = $derived(() => (lang === 'ar' ? ['إث', 'ثل', 'أر', 'خم', 'جم', 'سب', 'أح'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']));

	const calendarDays = $derived(() => {
		const year = currentMonth.getFullYear();
		const month = currentMonth.getMonth();
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);
		const startPadding = (firstDay.getDay() + 6) % 7;
		const days: Array<{ date: Date; isCurrentMonth: boolean; isAvailable: boolean; dateStr: string }> = [];

		for (let i = 0; i < startPadding; i++) {
			const date = new Date(year, month, i - startPadding + 1);
			days.push({
				date,
				isCurrentMonth: false,
				isAvailable: false,
				dateStr: formatDateLocal(date)
			});
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		for (let i = 1; i <= lastDay.getDate(); i++) {
			const date = new Date(year, month, i);
			const dateStr = formatDateLocal(date);
			const isAvailable = date >= today && date <= new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
			days.push({
				date,
				isCurrentMonth: true,
				isAvailable,
				dateStr
			});
		}

		const remaining = 42 - days.length;
		for (let i = 1; i <= remaining; i++) {
			const date = new Date(year, month + 1, i);
			days.push({
				date,
				isCurrentMonth: false,
				isAvailable: false,
				dateStr: formatDateLocal(date)
			});
		}

		return days;
	});

	function formatMonthYear(date: Date) {
		// locale is a $derived getter; call it so Intl receives a real locale string.
		return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(date);
	}

	const prevMonthLabel = $derived(() => (lang === 'ar' ? 'الشهر السابق' : 'Previous month'));
	const nextMonthLabel = $derived(() => (lang === 'ar' ? 'الشهر التالي' : 'Next month'));
</script>

<div>
	<div class="flex items-center justify-between mb-4">
		<h3 class="text-lg font-medium text-gray-900">{formatMonthYear(currentMonth)}</h3>
		<div class="flex gap-2">
			<button onclick={onPrevMonth} class="p-2 hover:bg-gray-100 rounded-full transition" aria-label={prevMonthLabel()}>
				<svg class="w-5 h-5 text-gray-600 rtl-flip" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
				</svg>
			</button>
			<button onclick={onNextMonth} class="p-2 hover:bg-gray-100 rounded-full transition" aria-label={nextMonthLabel()}>
				<svg class="w-5 h-5 text-gray-600 rtl-flip" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
				</svg>
			</button>
		</div>
	</div>

	<div class="grid grid-cols-7 gap-1 mb-2">
		{#each weekDays as day}
			<div class="text-center text-xs font-medium text-gray-500 py-2">{day}</div>
		{/each}
	</div>

	<div class="grid grid-cols-7 gap-1">
		{#each calendarDays() as day}
			{@const hasSlots = availableDates.has(day.dateStr)}
			{@const isClickable = day.isAvailable && hasSlots}
			{@const isSelected = selectedDate === day.dateStr}
			<button
				type="button"
				onclick={() => isClickable && onDateSelect(day.dateStr)}
				disabled={!isClickable}
				class="aspect-square flex items-center justify-center text-sm rounded-full transition relative
					{!day.isCurrentMonth ? 'text-gray-300' : ''}
					{isClickable && !isSelected ? 'font-semibold cursor-pointer' : ''}
					{day.isAvailable && !hasSlots && day.isCurrentMonth ? 'text-gray-400' : ''}
					{!day.isAvailable && day.isCurrentMonth ? 'text-gray-300 cursor-not-allowed' : ''}
					{isSelected ? 'text-white' : ''}"
				style="{isClickable && !isSelected ? `background-color: ${brandLighter}; color: ${brandDark}` : ''}{isSelected ? `background-color: var(--foreground-accent), ${brandColor}` : ''}"
			>
				{nf().format(day.date.getDate())}
			</button>
		{/each}
	</div>
</div>

<script lang="ts">
	import { TIMEZONE_GROUPS, getCurrentTime, getTimezoneLabel, getTimezoneGroupLabel } from '$lib/constants/timezones';

	interface Props {
		selectedTimezone: string;
		onSelect: (tz: string) => void;
		onClose: () => void;
		brandColor?: string;
		lang?: string;
	}

	let { selectedTimezone, onSelect, onClose, brandColor = '#3b82f6', lang = 'en' }: Props = $props();
	const locale = $derived(() => (lang === 'ar' ? 'ar-EG-u-nu-arab' : 'en-US'));

	const ui = $derived(() => {
		if (lang === 'ar') {
			return {
				close: 'إغلاق اختيار المنطقة الزمنية',
				search: 'بحث...',
				header: 'المنطقة الزمنية',
				noResults: (q: string) => `لا توجد مناطق زمنية تطابق "${q}"`
			};
		}
		return {
			close: 'Close timezone selector',
			search: 'Search...',
			header: 'Time zone',
			noResults: (q: string) => `No timezones found for "${q}"`
		};
	});

	const groups = $derived(() => TIMEZONE_GROUPS);

	function localizeDigits(text: string) {
		if (lang !== 'ar') return text;
		return text.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + (d.charCodeAt(0) - 48)));
	}

	let searchQuery = $state('');
	let searchInput: HTMLInputElement;

	// Filter timezones based on search
	const filteredGroups = $derived(() => {
		if (!searchQuery.trim()) {
			return groups();
		}

		const query = searchQuery.toLowerCase();
		const filtered: Record<string, Array<{ value: string; label: string }>> = {};

		for (const [group, zones] of Object.entries(groups())) {
			const matchingZones = zones.filter(
				(tz) =>
					(tz.label || '').toLowerCase().includes(query) ||
					getTimezoneLabel(tz.value, 'ar').toLowerCase().includes(query) ||
					getTimezoneGroupLabel(group, 'ar').toLowerCase().includes(query) ||
					tz.value.toLowerCase().includes(query) ||
					group.toLowerCase().includes(query)
			);
			if (matchingZones.length > 0) {
				filtered[group] = matchingZones;
			}
		}

		return filtered;
	});

	function handleSelect(tz: string) {
		onSelect(tz);
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	// Focus search input on mount
	$effect(() => {
		searchInput?.focus();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
	<button
	type="button"
	class="fixed inset-0 bg-black/20 z-40"
	onclick={onClose}
		aria-label={ui.close}
></button>

<!-- Modal - Always centered on screen -->
<div class="timezone-selector fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md border border-gray-200 rounded-xl shadow-2xl z-50 max-h-[80vh] flex flex-col overflow-hidden">
	<!-- Search -->
	<div class="p-3 border-b border-gray-100">
		<div class="relative">
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
			</svg>
				<input
				bind:this={searchInput}
				bind:value={searchQuery}
				type="text"
					placeholder={ui.search}
				class="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:border-transparent outline-none"
				style="--tw-ring-color: {brandColor}"
			/>
		</div>
	</div>

	<!-- Header -->
		<div class="px-4 py-2 border-b border-gray-100 bg-gray-50">
			<span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{ui.header}</span>
	</div>

	<!-- Timezone list -->
		<div class="overflow-y-auto flex-1" role="listbox" aria-label={ui.header}>
		{#each Object.entries(filteredGroups()) as [group, zones]}
			<div role="group" aria-labelledby="group-{group}">
				<div id="group-{group}" class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
					{getTimezoneGroupLabel(group, lang)}
				</div>
				{#each zones as tz}
					{@const isSelected = selectedTimezone === tz.value}
					<button
						type="button"
						role="option"
						aria-selected={isSelected}
						onclick={() => handleSelect(tz.value)}
						class="w-full px-4 py-2.5 flex items-center justify-between text-left text-sm hover:bg-gray-50 transition-colors {isSelected ? 'font-medium' : 'text-gray-700'}"
						style={isSelected ? `background-color: color-mix(in srgb, ${brandColor} 10%, white); color: ${brandColor}` : ''}
					>
						<span class="flex items-center gap-2">
							{#if isSelected}
								<svg class="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
									<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
								</svg>
							{:else}
								<span class="w-4"></span>
							{/if}
							<span>{localizeDigits(getTimezoneLabel(tz.value, lang))}</span>
						</span>
						<!-- locale is a $derived getter; call it to ensure Arabic digits/locale are applied -->
						<span class="text-gray-400 tabular-nums">{getCurrentTime(tz.value, false, locale())}</span>
					</button>
				{/each}
			</div>
		{/each}

			{#if Object.keys(filteredGroups()).length === 0}
				<div class="px-4 py-8 text-center text-sm text-gray-500">{ui.noResults(searchQuery)}</div>
			{/if}
	</div>
</div>
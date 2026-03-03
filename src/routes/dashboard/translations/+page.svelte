<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';

	let { data }: { data: PageData } = $props();

	type Map = Record<string, string>;
	const template = data.template as { keys: string[]; en: Map; ar: Map };
	const saved = (data.translations || {}) as { en?: Map; ar?: Map };

	let rows = $state(
		template.keys.map((k) => ({
			key: k,
			defaultEn: template.en[k] || '',
			defaultAr: template.ar[k] || '',
			en: saved.en?.[k] || '',
			ar: saved.ar?.[k] || ''
		}))
	);

	function buildPayload() {
		const en: Map = {};
		const ar: Map = {};
		for (const r of rows) {
			const enVal = (r.en || '').trim();
			const arVal = (r.ar || '').trim();
			if (enVal) en[r.key] = enVal;
			if (arVal) ar[r.key] = arVal;
		}
		return { en, ar };
	}
</script>

<div class="max-w-5xl mx-auto p-8">
	<div class="flex items-center gap-4 mb-6">
		<a href="/dashboard" class="text-gray-500 hover:text-gray-700">←</a>
		<div>
			<h1 class="text-2xl font-semibold">Translations</h1>
			<p class="text-sm text-gray-500">Translate the public booking UI and the embed widget (English/Arabic).</p>
		</div>
	</div>

	<form
		method="POST"
		use:enhance
		on:submit={(e) => {
			// Serialize our table into a JSON string input.
			const payload = buildPayload();
			const input = (e.currentTarget as HTMLFormElement).querySelector(
				'input[name="translations_json"]'
			) as HTMLInputElement;
			input.value = JSON.stringify(payload);
		}}
		class="bg-white rounded-lg border p-6"
	>
		<input type="hidden" name="translations_json" value="" />

		<div class="overflow-auto">
			<table class="w-full text-sm">
				<thead class="text-left text-gray-500">
					<tr>
						<th class="py-2 pr-4">Key</th>
						<th class="py-2 pr-4">Default (EN)</th>
						<th class="py-2 pr-4">Your EN override</th>
						<th class="py-2">Arabic (AR)</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.key)}
						<tr class="border-t">
							<td class="py-3 pr-4 font-mono text-xs text-gray-700">{r.key}</td>
							<td class="py-3 pr-4 text-gray-700">{r.defaultEn}</td>
							<td class="py-3 pr-4">
								<input
									class="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
									placeholder={r.defaultEn}
									bind:value={r.en}
								/>
							</td>
							<td class="py-3">
								<input
									dir="rtl"
									class="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
									placeholder={r.defaultAr || '—'}
									bind:value={r.ar}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-6 flex items-center justify-between">
			<p class="text-xs text-gray-500">
				Leave an override empty to use the default text.
			</p>
			<button
				type="submit"
				class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
			>
				Save
			</button>
		</div>
	</form>
</div>

<script lang="ts">
	interface Props {
		lang?: 'en' | 'ar';
		tr?: Record<string, string>;
		bookingForm: {
			name: string;
			email: string;
			notes: string;
		};
		bookingStatus: 'idle' | 'submitting' | 'success' | 'error';
		bookingError: string;
		brandColor: string;
		brandDark: string;
		onSubmit: (e: Event) => void;
	}

	let {
		lang = 'en',
		tr = {},
		bookingForm = $bindable(),
		bookingStatus,
		bookingError,
		brandColor,
		brandDark,
		onSubmit
	}: Props = $props();
</script>

<div class="max-w-md">
	<h2 class="text-xl font-semibold text-gray-900 mb-6">
		{tr.yourInfo ?? (lang === 'ar' ? 'معلوماتك' : 'Enter Details')}
	</h2>

	{#if bookingError}
		<div class="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6">
			{bookingError}
		</div>
	{/if}

	<form onsubmit={onSubmit} class="space-y-5">
		<div>
			<label for="name" class="block text-sm font-medium text-gray-700 mb-2">
				{tr.nameLabel ?? (lang === 'ar' ? 'الاسم الكامل' : 'Name')} *
			</label>
			<input
				type="text"
				id="name"
				bind:value={bookingForm.name}
				required
				class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none"
				style="--tw-ring-color: {brandColor}"
			/>
		</div>
		<div>
			<label for="email" class="block text-sm font-medium text-gray-700 mb-2">
				{tr.emailLabel ?? (lang === 'ar' ? 'البريد الإلكتروني' : 'Email')} *
			</label>
			<input
				type="email"
				id="email"
				bind:value={bookingForm.email}
				required
				class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none"
				style="--tw-ring-color: {brandColor}"
			/>
		</div>
		<div>
			<label for="notes" class="block text-sm font-medium text-gray-700 mb-2">
				{tr.notesLabel ?? (lang === 'ar'
					? 'ملاحظات (اختياري)'
					: 'Please share anything that will help prepare for our meeting.')}
			</label>
			<textarea
				id="notes"
				bind:value={bookingForm.notes}
				rows="4"
				class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none resize-none"
				style="--tw-ring-color: {brandColor}"
			></textarea>
		</div>
		<button
			type="submit"
			disabled={bookingStatus === 'submitting'}
			class="w-full text-white py-3 px-6 rounded-full font-semibold transition disabled:opacity-50"
			style="background-color: {brandColor}"
			onmouseenter={(e) => e.currentTarget.style.backgroundColor = brandDark}
			onmouseleave={(e) => e.currentTarget.style.backgroundColor = brandColor}
		>
			{bookingStatus === 'submitting'
				? (lang === 'ar' ? 'جارٍ الحجز…' : 'Scheduling...')
				: (tr.confirmBooking ?? (lang === 'ar' ? 'تأكيد الحجز' : 'Confirm booking'))}
		</button>
	</form>
</div>

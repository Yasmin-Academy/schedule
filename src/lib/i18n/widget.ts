export type WidgetLang = 'en' | 'ar';

type Dict = Record<string, string>;

const EN: Dict = {
	title: 'Book a meeting',
	loading: 'Loading…',
	error: 'Something went wrong. Please try again.',
	selectDate: 'Select a date',
	selectTime: 'Select a time',
	noDates: 'No available dates found.',
	noSlots: 'No available time slots for this date.',
	name: 'Name',
	email: 'Email',
	notes: 'Notes (optional)',
	confirm: 'Confirm booking',
	confirming: 'Booking…',
	successTitle: 'Booked!',
	successBody: 'Check your email for confirmation.',
	poweredBy: ''
};

const AR: Dict = {
	title: 'احجز موعداً',
	loading: 'جارٍ التحميل…',
	error: 'حدث خطأ. حاول مرة أخرى.',
	selectDate: 'اختر التاريخ',
	selectTime: 'اختر الوقت',
	noDates: 'لا توجد تواريخ متاحة.',
	noSlots: 'لا توجد أوقات متاحة لهذا التاريخ.',
	name: 'الاسم',
	email: 'البريد الإلكتروني',
	notes: 'ملاحظات (اختياري)',
	confirm: 'تأكيد الحجز',
	confirming: 'جارٍ الحجز…',
	successTitle: 'تم الحجز!',
	successBody: 'تحقق من بريدك الإلكتروني للتأكيد.',
	poweredBy: 'مشغّل بواسطة CloudMeet'
};

export function normalizeLang(input?: string | null): WidgetLang {
	const l = (input || '').toLowerCase();
	return l === 'ar' ? 'ar' : 'en';
}

export function t(lang: WidgetLang, key: keyof typeof EN): string {
	const dict = lang === 'ar' ? AR : EN;
	return dict[key] ?? EN[key] ?? String(key);
}

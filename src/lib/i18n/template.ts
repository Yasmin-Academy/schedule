// Canonical translation template for the booking UI + any shared copy.
//
// This file is used to:
//  - define the list of keys that the dashboard UI shows
//  - provide safe defaults when a key is missing

export type Lang = 'en' | 'ar';

// Keep keys stable. Add new keys here when you add new UI copy.
export const EN_TRANSLATIONS = {
  bookingTitle: 'Book a consultation',
  // Booking steps / headings
  stepSelectDate: 'Select a date',
  stepSelectTime: 'Select a time',
  stepConfirm: 'Confirm',

  // Aliases used in some parts of the UI
  selectDate: 'Select a date',
  selectTime: 'Select a time',
  stepEnterDetails: 'Enter details',

  timezone: 'Time zone',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  at: 'at',

  // Meeting / platform labels
  meetingLabel: 'Meeting',
  hostLabel: 'Host',
  googleMeet: 'Google Meet',
  msTeams: 'Microsoft Teams',

  onlineRoom: 'Online Room',
  roomNote: 'Room link and details will be sent by email after booking.',
  yourInfo: 'Your information',
  nameLabel: 'Full name',
  emailLabel: 'Email address',
  notesLabel: 'Notes (optional)',
  confirmBooking: 'Confirm booking',
  noAvailableTimes: 'No available times for this date',
  back: 'Back',
  next: 'Next',
  youAreScheduled: 'You are scheduled',
  inviteSent: 'A calendar invitation has been sent to your email address.',
  openOnlineRoom: 'Open Online Room',

  // Mobile form copy (legacy keys kept stable)
  yourName: 'Name',
  yourEmail: 'Email',
  additionalNotes: 'Additional notes',
  scheduling: 'Scheduling...',
  scheduleEvent: 'Schedule Event'
} as const;

export const AR_TRANSLATIONS: Record<keyof typeof EN_TRANSLATIONS, string> = {
  bookingTitle: 'احجز استشارة',
  stepSelectDate: 'اختر التاريخ',
  stepSelectTime: 'اختر الوقت',
  stepConfirm: 'تأكيد',

  selectDate: 'اختر التاريخ',
  selectTime: 'اختر الوقت',
  stepEnterDetails: 'أدخل البيانات',

  timezone: 'المنطقة الزمنية',
  previousMonth: 'الشهر السابق',
  nextMonth: 'الشهر التالي',
  at: 'عند',

  meetingLabel: 'اجتماع',
  hostLabel: 'المضيف',
  googleMeet: 'Google Meet',
  msTeams: 'Microsoft Teams',

  onlineRoom: 'غرفة أونلاين',
  roomNote: 'سيتم إرسال رابط الغرفة والتفاصيل عبر البريد الإلكتروني بعد الحجز.',
  yourInfo: 'معلوماتك',
  nameLabel: 'الاسم الكامل',
  emailLabel: 'البريد الإلكتروني',
  notesLabel: 'ملاحظات (اختياري)',
  confirmBooking: 'تأكيد الحجز',
  noAvailableTimes: 'لا توجد أوقات متاحة لهذا التاريخ',
  back: 'رجوع',
  next: 'التالي',
  youAreScheduled: 'تم تأكيد الحجز',
  inviteSent: 'تم إرسال دعوة تقويم إلى بريدك الإلكتروني.',
  openOnlineRoom: 'افتح الغرفة الأونلاين',

  yourName: 'الاسم',
  yourEmail: 'البريد الإلكتروني',
  additionalNotes: 'ملاحظات إضافية',
  scheduling: 'جارٍ الحجز…',
  scheduleEvent: 'احجز الموعد'
};

export const ALL_TRANSLATION_KEYS = Object.keys(EN_TRANSLATIONS) as Array<keyof typeof EN_TRANSLATIONS>;

export type TranslationMap = Record<string, string>;

export function resolveTranslations(lang: string | undefined, custom: TranslationMap | null | undefined) {
  const base = (lang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS) as TranslationMap;
	// Backwards compatible:
	//  - old shape: { bookingTitle: '...' }
	//  - new shape: { en: {..}, ar: {..} }
	const anyCustom = (custom || {}) as any;
	const perLang =
		anyCustom && typeof anyCustom === 'object' && (anyCustom.en || anyCustom.ar)
			? (lang === 'ar' ? anyCustom.ar : anyCustom.en)
			: null;
	// If we detect the new shape, only apply overrides for the active language.
	// If we only have the old shape, treat it as English overrides.
	const overrides = perLang ? (perLang as TranslationMap) : lang === 'ar' ? {} : (custom || {});
	return { ...base, ...(overrides || {}) } as TranslationMap;
}

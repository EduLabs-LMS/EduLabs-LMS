import type { Language } from '@/shared/language';

const en = {
  'ti.brand_note': 'Secure teacher onboarding',
  'ti.title': 'Accept your teacher invitation',
  'ti.intro': 'Use the one-time code shared by the EduLabs administrator to claim your teacher portal.',
  'ti.card_title': 'Invitation details',
  'ti.code_label': 'Invitation code',
  'ti.code_hint': 'Paste the full 43-character code. It can be used once and expires.',
  'ti.code_placeholder': 'Paste invitation code',
  'ti.signed_in_as': 'Signed in as {email}',
  'ti.email_unavailable': 'email unavailable',
  'ti.sign_in_required': 'Sign in with the invited email address and verify it before accepting this invitation.',
  'ti.account_unverified': 'Verify your email first, then return here to accept the invitation.',
  'ti.sign_in_accept': 'Sign in to continue',
  'ti.sign_in': 'Sign in',
  'ti.accept': 'Accept invitation',
  'ti.working': 'Checking invitation…',
  'ti.privacy_note': 'Your code is sent securely to EduLabs and is never placed in the page URL.',
  'ti.auth.loading': 'Checking your sign-in…',
  'ti.auth.unavailable': 'Your sign-in status could not be checked. Reload the page or sign in again.',
  'ti.error.invalid_input': 'Enter the complete 43-character invitation code.',
  'ti.error.invalid': 'This invitation code is not valid. Check it and try again.',
  'ti.error.not_found': 'This invitation code was not found. Ask the administrator to check the code.',
  'ti.error.used': 'This invitation has already been used. If you just accepted it, ask the administrator to confirm the portal status.',
  'ti.error.gone': 'This invitation has expired or was revoked. Ask the administrator to issue a new code.',
  'ti.error.email_mismatch': 'This account cannot accept the invitation. Sign in with the invited email address and verify that email.',
  'ti.error.unavailable': 'We could not accept the invitation right now. Please try again later.',
  'ti.error.unknown': 'We lost contact with the server before it confirmed the result. Do not submit again yet; ask the administrator to check the portal status first.',
  'ti.error.retry_after_check': 'I checked with the administrator — allow another attempt',
  'ti.error.storage': 'This browser could not temporarily keep the code for sign-in. Sign in first, then paste the code again.',
  'ti.success.title': 'Invitation accepted',
  'ti.success.body': 'Your account now owns this teacher portal. The teacher workspace is still being completed, so its management screens may not be available yet.',
  'ti.success.home': 'Go to Home',
} as const;

const ar: Record<keyof typeof en, string> = {
  'ti.brand_note': 'إعداد آمن لحساب المعلم',
  'ti.title': 'قبول دعوة المعلم',
  'ti.intro': 'استخدم الرمز لمرة واحدة الذي شاركه مسؤول EduLabs للمطالبة ببوابة المعلم الخاصة بك.',
  'ti.card_title': 'تفاصيل الدعوة',
  'ti.code_label': 'رمز الدعوة',
  'ti.code_hint': 'الصق الرمز الكامل المكوّن من 43 حرفًا. يُستخدم مرة واحدة وتنتهي صلاحيته.',
  'ti.code_placeholder': 'الصق رمز الدعوة',
  'ti.signed_in_as': 'تم تسجيل الدخول باسم {email}',
  'ti.email_unavailable': 'البريد الإلكتروني غير متاح',
  'ti.sign_in_required': 'سجّل الدخول باستخدام البريد الإلكتروني المدعو وتأكد من التحقق منه قبل قبول الدعوة.',
  'ti.account_unverified': 'تحقق من بريدك الإلكتروني أولًا، ثم ارجع إلى هنا لقبول الدعوة.',
  'ti.sign_in_accept': 'تسجيل الدخول والمتابعة',
  'ti.sign_in': 'تسجيل الدخول',
  'ti.accept': 'قبول الدعوة',
  'ti.working': 'جارٍ التحقق من الدعوة…',
  'ti.privacy_note': 'يُرسل الرمز بأمان إلى EduLabs ولا يُضاف مطلقًا إلى عنوان الصفحة.',
  'ti.auth.loading': 'جارٍ التحقق من تسجيل الدخول…',
  'ti.auth.unavailable': 'تعذر التحقق من حالة تسجيل الدخول. أعد تحميل الصفحة أو سجّل الدخول مجددًا.',
  'ti.error.invalid_input': 'أدخل رمز الدعوة الكامل المكوّن من 43 حرفًا.',
  'ti.error.invalid': 'رمز الدعوة غير صالح. تحقق منه وحاول مرة أخرى.',
  'ti.error.not_found': 'لم يتم العثور على رمز الدعوة. اطلب من المسؤول التحقق من الرمز.',
  'ti.error.used': 'تم استخدام هذه الدعوة بالفعل. إذا كنت قد قبلتها للتو، فاطلب من المسؤول تأكيد حالة البوابة.',
  'ti.error.gone': 'انتهت صلاحية الدعوة أو أُلغيت. اطلب من المسؤول إصدار رمز جديد.',
  'ti.error.email_mismatch': 'لا يمكن لهذا الحساب قبول الدعوة. سجّل الدخول باستخدام البريد الإلكتروني المدعو وتأكد من التحقق منه.',
  'ti.error.unavailable': 'تعذر قبول الدعوة الآن. حاول مرة أخرى لاحقًا.',
  'ti.error.unknown': 'انقطع الاتصال قبل تأكيد النتيجة. لا تعاود الإرسال الآن؛ اطلب من المسؤول التحقق من حالة البوابة أولًا.',
  'ti.error.retry_after_check': 'تحققت مع المسؤول — السماح بمحاولة أخرى',
  'ti.error.storage': 'تعذر حفظ الرمز مؤقتًا في هذا المتصفح للمتابعة إلى تسجيل الدخول. سجّل الدخول أولًا ثم الصق الرمز مجددًا.',
  'ti.success.title': 'تم قبول الدعوة',
  'ti.success.body': 'أصبح حسابك الآن مالك بوابة المعلم هذه. ما زلنا نعمل على استكمال مساحة عمل المعلم، لذا قد لا تكون شاشات الإدارة متاحة بعد.',
  'ti.success.home': 'الانتقال إلى الرئيسية',
};

export const teacherInvitationMessages = { en, ar };
export type TeacherInvitationMessageKey = keyof typeof en;
export function translateTeacherInvitation(language: Language, key: TeacherInvitationMessageKey, values: Record<string, string | number> = {}) {
  const template = teacherInvitationMessages[language][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
}

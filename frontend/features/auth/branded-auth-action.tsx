'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import EduLabsMark from '@/frontend/components/edulabs-mark';
import { getFirebaseAuth } from '@/frontend/lib/firebase';

type Mode = 'verifyEmail' | 'resetPassword' | '';

const actionCopy = {
  en: {
    loading: 'Checking your link…',
    invalidLink: 'This link is invalid or incomplete. Request a new email and try again.',
    verifyPrompt: 'Confirm below to verify your email address.',
    resetPrompt: 'Choose a new password for your EduLabs account.',
    expired: 'This link has expired, has already been used, or is invalid. Request a new email to continue.',
    verified: 'Your email address is verified. You can now sign in to EduLabs.',
    passwordUpdated: 'Your password has been updated. You can now sign in securely.',
    weakPassword: 'Choose a password with at least 12 characters.',
    mismatch: 'The passwords do not match.',
    invalidAction: 'This action link is invalid.',
    strongerPassword: 'Choose a stronger password.',
    invalidAgain: 'This link is no longer valid. Request a new email and try again.',
    account: 'EDULABS ACCOUNT',
    verifyHeading: 'Verify your email',
    resetHeading: 'Reset your password',
    actionHeading: 'Authentication link',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    pleaseWait: 'Please wait…',
    verifyButton: 'Verify email address',
    updateButton: 'Update password',
    signIn: 'Return to sign in',
    requestReset: 'Request another reset link',
    footer: 'EduLabs will never ask you to share your password or one-time link.',
  },
  ar: {
    loading: 'جارٍ التحقق من الرابط…',
    invalidLink: 'هذا الرابط غير صالح أو غير مكتمل. اطلب رسالة جديدة ثم حاول مرة أخرى.',
    verifyPrompt: 'أكّد أدناه لتأكيد عنوان بريدك الإلكتروني.',
    resetPrompt: 'اختر كلمة مرور جديدة لحسابك على EduLabs.',
    expired: 'انتهت صلاحية هذا الرابط، أو سبق استخدامه، أو أنه غير صالح. اطلب رسالة جديدة للمتابعة.',
    verified: 'تم تأكيد بريدك الإلكتروني. يمكنك الآن تسجيل الدخول إلى EduLabs.',
    passwordUpdated: 'تم تحديث كلمة مرورك. يمكنك الآن تسجيل الدخول بأمان.',
    weakPassword: 'اختر كلمة مرور لا تقل عن 12 حرفًا.',
    mismatch: 'كلمتا المرور غير متطابقتين.',
    invalidAction: 'رابط الإجراء هذا غير صالح.',
    strongerPassword: 'اختر كلمة مرور أقوى.',
    invalidAgain: 'لم يعد هذا الرابط صالحًا. اطلب رسالة جديدة ثم حاول مرة أخرى.',
    account: 'حساب EDULABS',
    verifyHeading: 'تأكيد بريدك الإلكتروني',
    resetHeading: 'إعادة تعيين كلمة المرور',
    actionHeading: 'رابط التحقق',
    newPassword: 'كلمة المرور الجديدة',
    confirmPassword: 'تأكيد كلمة المرور الجديدة',
    pleaseWait: 'جارٍ التنفيذ…',
    verifyButton: 'تأكيد البريد الإلكتروني',
    updateButton: 'تحديث كلمة المرور',
    signIn: 'العودة إلى تسجيل الدخول',
    requestReset: 'طلب رابط إعادة تعيين جديد',
    footer: 'لن تطلب منك EduLabs أبدًا مشاركة كلمة مرورك أو رابط التحقق لمرة واحدة.',
  },
} as const;

export default function BrandedAuthAction() {
  const [mode, setMode] = useState<Mode>('');
  const [locale, setLocale] = useState<'en' | 'ar'>('en');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Remove the one-time code from the address bar/history as soon as it is read.
    const previousLanguage = document.documentElement.lang || 'en';
    const previousDirection = document.documentElement.dir || 'ltr';
    const current = new URL(window.location.href);
    const requestedLocale = current.searchParams.get('lang');
    const selectedLocale: 'en' | 'ar' = requestedLocale === 'ar' || requestedLocale === 'en'
      ? requestedLocale
      : previousLanguage === 'ar' ? 'ar' : 'en';
    const text = actionCopy[selectedLocale];
    setLocale(selectedLocale);
    document.documentElement.lang = selectedLocale;
    document.documentElement.dir = selectedLocale === 'ar' ? 'rtl' : 'ltr';
    const action = current.searchParams.get('mode');
    const oobCode = current.searchParams.get('oobCode') ?? '';
    window.history.replaceState({}, document.title, '/auth/action');
    if ((action !== 'verifyEmail' && action !== 'resetPassword') || !oobCode || oobCode.length > 4096) {
      setLinkInvalid(true);
      setMessage(text.invalidLink);
      setReady(true);
      return () => {
        document.documentElement.lang = previousLanguage;
        document.documentElement.dir = previousDirection;
      };
    }
    setMode(action);
    setCode(oobCode);
    void (async () => {
      try {
        const auth = getFirebaseAuth();
        const info = await checkActionCode(auth, oobCode);
        if (action === 'verifyEmail') {
          setEmail(info.data.email ?? '');
          setMessage(text.verifyPrompt);
        } else {
          const address = await verifyPasswordResetCode(auth, oobCode);
          setEmail(address);
          setMessage(text.resetPrompt);
        }
      } catch {
        setLinkInvalid(true);
        setMessage(text.expired);
      } finally {
        setReady(true);
      }
    })();
    return () => {
      document.documentElement.lang = previousLanguage;
      document.documentElement.dir = previousDirection;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !code || busy || success || linkInvalid) return;
    setBusy(true);
    setMessage('');
    const text = actionCopy[locale];
    try {
      const auth = getFirebaseAuth();
      if (mode === 'verifyEmail') {
        await applyActionCode(auth, code);
        setSuccess(true);
        setMessage(text.verified);
      } else if (mode === 'resetPassword') {
        if (password.length < 12) throw new Error(text.weakPassword);
        if (password !== confirm) throw new Error(text.mismatch);
        await confirmPasswordReset(auth, code, password);
        setSuccess(true);
        setMessage(text.passwordUpdated);
      } else {
        throw new Error(text.invalidAction);
      }
    } catch (failure) {
      const code = (failure as { code?: string }).code;
      const safe = failure instanceof Error && !code ? failure.message : '';
      setMessage(safe || (code === 'auth/weak-password' ? text.strongerPassword : text.invalidAgain));
    } finally {
      setBusy(false);
    }
  }

  const text = actionCopy[locale];
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const canSubmit = ready && !!code && !success && !linkInvalid && !!mode;

  return <main lang={locale} dir={direction} className="min-h-screen bg-[#e9eee5] px-4 py-12 text-[#142011]">
    <div className="mx-auto max-w-lg">
      <header className="mb-6 flex items-center gap-3">
        <EduLabsMark />
        <span dir="ltr" className="text-2xl font-extrabold tracking-tight">EduLabs</span>
      </header>
      <section className="rounded-3xl border-2 border-black bg-[#f7f8f3] p-6 shadow-[5px_5px_0_#111] sm:p-9">
        <p className="mb-3 text-xs font-extrabold uppercase tracking-[.16em] text-[#276b39]">{text.account}</p>
        <h1 className="mb-3 text-3xl font-extrabold tracking-tight">
          {!ready ? text.loading : mode === 'verifyEmail' ? text.verifyHeading : mode === 'resetPassword' ? text.resetHeading : text.actionHeading}
        </h1>
        {email && <p className="mb-4 break-words text-sm text-slate-600"><bdi dir="ltr">{email}</bdi></p>}
        {message && <p role="status" aria-live="polite" className="mb-5 rounded-xl border border-[#cbd8c4] bg-white p-4 text-sm leading-7">{message}</p>}
        {canSubmit && <form onSubmit={submit} className="space-y-4">
          {mode === 'resetPassword' && <>
            <label className="block text-sm font-semibold">{text.newPassword}
              <input autoComplete="new-password" type="password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} dir="ltr" className="mt-2 w-full rounded-xl border-2 border-black bg-white p-3 text-left outline-none focus:ring-2 focus:ring-[#7ed957]" />
            </label>
            <label className="block text-sm font-semibold">{text.confirmPassword}
              <input autoComplete="new-password" type="password" minLength={12} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)} dir="ltr" className="mt-2 w-full rounded-xl border-2 border-black bg-white p-3 text-left outline-none focus:ring-2 focus:ring-[#7ed957]" />
            </label>
          </>}
          <button type="submit" disabled={busy} className="w-full rounded-xl border-2 border-black bg-[#7ed957] p-3 font-bold shadow-[3px_3px_0_#111] disabled:opacity-60">
            {busy ? text.pleaseWait : mode === 'verifyEmail' ? text.verifyButton : text.updateButton}
          </button>
        </form>}
        <div className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
          <Link href="/sign-in" className="underline underline-offset-4">{text.signIn}</Link>
          {!success && mode === 'resetPassword' && <Link href="/sign-in" className="underline underline-offset-4">{text.requestReset}</Link>}
        </div>
      </section>
      <p className="mt-6 text-center text-xs text-slate-600">{text.footer}</p>
    </div>
  </main>;
}

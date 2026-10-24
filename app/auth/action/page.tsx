import { Suspense } from 'react';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import BrandedAuthAction from '@/frontend/features/auth/branded-auth-action';
import { isLanguage, languageCookieKey, type Language } from '@/shared/language';

export const dynamic = 'force-dynamic';

type SearchParams = { [key: string]: string | string[] | undefined };
type PageProps = { searchParams: Promise<SearchParams> };

async function resolveLocale(params: SearchParams): Promise<Language> {
  const queryLanguage = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  if (isLanguage(queryLanguage)) return queryLanguage;
  const savedLanguage = (await cookies()).get(languageCookieKey)?.value;
  return isLanguage(savedLanguage) ? savedLanguage : 'en';
}

function actionMode(params: SearchParams) {
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  return mode === 'resetPassword' ? 'resetPassword' : 'verifyEmail';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const locale = await resolveLocale(params);
  const reset = actionMode(params) === 'resetPassword';
  const title = locale === 'ar'
    ? (reset ? 'إعادة تعيين كلمة مرور EduLabs' : 'تأكيد بريدك الإلكتروني · EduLabs')
    : (reset ? 'Reset your EduLabs password' : 'Verify your EduLabs email');
  const description = locale === 'ar'
    ? 'أكمل التحقق من بريدك الإلكتروني أو حدّث كلمة مرورك بأمان.'
    : 'Verify your email or securely update your EduLabs password.';
  return { title, description, robots: { index: false, follow: false } };
}

export default async function AuthActionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const locale = await resolveLocale(params);
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const loading = locale === 'ar' ? 'جارٍ التحقق من رابط حسابك الآمن…' : 'Loading secure account action…';

  return <Suspense fallback={<main lang={locale} dir={direction} className="min-h-screen bg-[#e9eee5] p-8 text-[#142011]">{loading}</main>}>
    <BrandedAuthAction initialLocale={locale} />
  </Suspense>;
}

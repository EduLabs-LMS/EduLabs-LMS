import { Suspense } from 'react';
import BrandedAuthAction from '@/frontend/features/auth/branded-auth-action';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Secure your EduLabs account',
  description: 'Verify your email or securely update your EduLabs password.',
  robots: { index: false, follow: false },
};

export default function AuthActionPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#e9eee5] p-8 text-[#142011]">Loading secure account action…</main>}>
    <BrandedAuthAction />
  </Suspense>;
}

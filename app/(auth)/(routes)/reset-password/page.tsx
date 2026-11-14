import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { ResetPassword } from '@/frontend/features/auth/reset-password';

// The link carries a one-time code in its address: no referrer, no index, no cache (the middleware sets the headers too).
export const metadata: Metadata = { title: 'Choose a new password | EduLabs', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function Page() {
  if (!isFirebaseStaging()) notFound();
  return <ResetPassword />;
}

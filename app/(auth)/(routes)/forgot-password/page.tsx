import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { ForgotPassword } from '@/frontend/features/auth/forgot-password';

export const metadata: Metadata = { title: 'Forgot your password? | EduLabs', robots: { index: false, follow: false } };

export default function Page() {
  if (!isFirebaseStaging()) notFound();
  return <ForgotPassword />;
}

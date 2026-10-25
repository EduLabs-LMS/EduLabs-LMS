import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TeacherInvitationAcceptance } from '@/frontend/features/teacher-invitation/acceptance-form';
import { isFirebaseStaging } from '@/shared/auth-config';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Accept teacher invitation | EduLabs',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function AcceptTeacherInvitationPage() {
  if (!isFirebaseStaging()) notFound();
  return <TeacherInvitationAcceptance />;
}

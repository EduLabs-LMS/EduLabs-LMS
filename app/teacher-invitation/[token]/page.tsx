import { notFound, redirect } from 'next/navigation';
import { getApplicationViewer } from '@/server/services/application-auth';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherInvitationAcceptance } from '@/frontend/features/teacher-invitation/acceptance-view';

export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export default async function TeacherInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isFirebaseStaging() || !tokenPattern.test(token)) notFound();
  const viewer = await getApplicationViewer();
  if (!viewer) redirect('/sign-in?next=' + encodeURIComponent('/teacher-invitation/' + token));
  return <main className="min-h-screen bg-[#eef2e9] px-4 py-10 sm:px-6 sm:py-16">
    <TeacherInvitationAcceptance token={token} email={viewer.email} />
  </main>;
}

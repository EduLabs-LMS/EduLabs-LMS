import { notFound } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherInvitationView } from '@/frontend/features/teacher-invitation/invitation-view';

export const dynamic = 'force-dynamic';

export default function TeacherInvitationPage() {
 if (!isFirebaseStaging()) notFound();
 return <TeacherInvitationView />;
}

import type { Metadata } from 'next';
import '@/frontend/design-system/tokens.css';
import '@/frontend/design-system/components.css';
import '@/frontend/styles/platform-admin.css';

// The page itself carries no secret (it lives in the URL fragment), but it must still stay out of indexes and referrers.
export const metadata: Metadata = { title: 'Teacher invitation | EduLabs', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function TeacherInvitationLayout({ children }: { children: React.ReactNode }) {
 return children;
}

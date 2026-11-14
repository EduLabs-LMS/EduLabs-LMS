import { notFound } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { liveClassConfigured } from '@/server/services/live-class-provider';
import { LiveClassView } from '@/frontend/features/live-class/class-view';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One Session's EduLabs class. Not there at all when the meeting server is not configured. Who may open it, and when, is decided by the database. */
export default async function Page({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ start?: string | string[] }> }) {
  const { sessionId } = await params;
  if (!uuid.test(sessionId) || !isFirebaseStaging() || !liveClassConfigured()) notFound();
  return <LiveClassView sessionId={sessionId} start={(await searchParams).start === '1'} />;
}

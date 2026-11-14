import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getApplicationViewer } from '@/server/services/application-auth';
import { liveClassConfigured } from '@/server/services/live-class-provider';
import { readLiveClassJoined } from '@/server/services/live-class';
import { Board } from '@/frontend/features/live-class/board';

export const metadata: Metadata = { title: 'Board | EduLabs', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The teacher's Board for one EduLabs class (staff only; owner, 2026-11-14: students never open or draw on any board). Its own route group, so
 * no frame or navigation: the whole tab is the board the teacher shares. The database decides who it is for: `live_class_joined` answers only the
 * Group's staff (private.can_manage_group), the same check as the attendance list. Everyone else, and every failure, gets "not found".
 */
export default async function BoardPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!uuid.test(sessionId) || !isFirebaseStaging() || !liveClassConfigured()) notFound();
  const viewer = await getApplicationViewer();
  if (!viewer || viewer.backend !== 'firebase') redirect('/sign-in');
  let allowed = false;
  try {
    const r = await readLiveClassJoined(sessionId);
    allowed = r.status === 200 && (r.body as { liveClass?: unknown }).liveClass === true;
  } catch { allowed = false; }
  if (!allowed) notFound();
  return <Board sessionId={sessionId} />;
}

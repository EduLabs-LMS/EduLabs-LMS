'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { L } from '@/frontend/components/language-provider';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { StatusPill, type Tone } from '@/frontend/components/design/status-pill';
import type { CourseStatus } from '@/shared/teacher-home';
import { coursePagePath } from '@/shared/teacher-course-page';

/** Re-runs the server reads for the whole page. */
export function useRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, retry: () => start(() => router.refresh()) };
}

/** A failed or unknown read is reported as such, never as an empty or "all clear" result. */
export function SectionError({ status, onRetry, pending }: { status: number | null; onRetry: () => void; pending: boolean }) {
  return <div role="alert" data-state="error" className="d-alert">
    <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>
      {status === 401 ? <L id="th.state.error_401" /> : status === 403 ? <L id="th.state.error_403" /> : <L id="th.state.error" />}
    </span></p>
    {status === 401
      ? <Link href="/sign-in" className={buttonClass('secondary')}><L id="th.state.signin" /></Link>
      : status === 403 ? null
      : <Button type="button" onClick={onRetry} disabled={pending}>{pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="th.state.retry" /></Button>}
  </div>;
}

export function Empty({ id, children }: { id: 'th.next.empty' | 'th.first.next' | 'th.updates.empty' | 'th.coming.empty' | 'th.courses.empty'; children?: React.ReactNode }) {
  return <div data-state="empty" className="d-stack"><p className="d-body"><L id={id} /></p>{children}</div>;
}

const tone: Record<CourseStatus, Tone> = { draft: 'warning', published: 'success', archived: 'neutral' };
export function StatusBadge({ status }: { status: CourseStatus }) {
  return <StatusPill tone={tone[status]} data-status={status}><L id={`th.courses.${status}`} /></StatusPill>;
}

export const sessionTime: Intl.DateTimeFormatOptions = { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };

/** The teacher's courses: cards on a desktop, rows on a phone. */
export function CourseCards({ items }: { items: { id: string; title: string; status: CourseStatus }[] }) {
  return <ul className="d-group-list">{items.map(c => <li key={c.id}>
    <Link href={coursePagePath(c.id)} data-course={c.id} className="d-course-card d-focus">
      <span className="d-label d-wrap"><bdi dir="auto">{c.title}</bdi></span>
      <StatusBadge status={c.status} />
    </Link>
  </li>)}</ul>;
}

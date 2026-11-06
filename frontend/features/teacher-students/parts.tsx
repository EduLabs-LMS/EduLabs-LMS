'use client';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { StatusPill as Pill, type Tone } from '@/frontend/components/design/status-pill';
import type { MessageKey } from '@/frontend/locales/messages';
import type { AdminOffering } from '@/shared/contracts/student-administration';
import { courseName, type StudentStatus } from '@/shared/teacher-students';

const tone: Record<StudentStatus, Tone> = { active: 'success', suspended: 'warning', expired: 'neutral', completed: 'info', cancelled: 'danger', invited: 'neutral' };
const statusKey: Record<StudentStatus, MessageKey> = { active: 'ts.students.status.active', suspended: 'ts.students.status.suspended', expired: 'ts.students.status.expired', completed: 'ts.students.status.completed', cancelled: 'ts.students.status.cancelled', invited: 'ts.students.status.invited' };

export function StatusPill({ status }: { status: StudentStatus }) {
  return <Pill tone={tone[status]} data-student-status={status}><L id={statusKey[status]} /></Pill>;
}

/** A student without a saved name is never shown as a blank line. */
export function StudentName({ name }: { name: string | null | undefined }) {
  return name?.trim() ? <bdi dir="auto">{name}</bdi> : <L id="ts.students.unnamed" />;
}

/** Course names the teacher sees: the course's title and nothing else. Two runs of one course read the same; the run's own name is never shown to tell them apart. */
export function courseLabels(offerings: readonly AdminOffering[]): Map<string, string> {
  return new Map(offerings.map(o => [o.id, courseName(o)]));
}

export const fieldClass = 'min-h-[48px] w-full rounded-xl border-2 border-black bg-white px-3 text-base';

export function useDate() {
  const { language } = useLanguage();
  return (value: string) => new Date(value).toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' });
}

'use client';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';
import type { AdminOffering } from '@/shared/contracts/student-administration';
import { courseName, type StudentStatus } from '@/shared/teacher-students';

const tone: Record<StudentStatus, string> = { active: 'bg-primary', suspended: 'bg-amber-100', expired: 'bg-slate-200', completed: 'bg-sky-100', cancelled: 'bg-rose-100', invited: 'bg-white' };
const statusKey: Record<StudentStatus, MessageKey> = { active: 'ts.students.status.active', suspended: 'ts.students.status.suspended', expired: 'ts.students.status.expired', completed: 'ts.students.status.completed', cancelled: 'ts.students.status.cancelled', invited: 'ts.students.status.invited' };

export function StatusPill({ status }: { status: StudentStatus }) {
  return <span data-student-status={status} className={`inline-flex min-h-[28px] w-fit items-center rounded-full border-2 border-black px-3 text-base font-bold text-black ${tone[status]}`}><L id={statusKey[status]} /></span>;
}

/** A student without a saved name is never shown as a blank line. */
export function StudentName({ name }: { name: string | null | undefined }) {
  return name?.trim() ? <bdi dir="auto">{name}</bdi> : <L id="ts.students.unnamed" />;
}

/** Course names the teacher sees; two courses with the same title are told apart by their own name. */
export function courseLabels(offerings: readonly AdminOffering[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const o of offerings) counts.set(courseName(o), (counts.get(courseName(o)) ?? 0) + 1);
  return new Map(offerings.map(o => [o.id, (counts.get(courseName(o)) ?? 0) > 1 && o.name !== courseName(o) ? `${courseName(o)} · ${o.name}` : courseName(o)]));
}

export const fieldClass = 'min-h-[48px] w-full rounded-xl border-2 border-black bg-white px-3 text-base';

export function useDate() {
  const { language } = useLanguage();
  return (value: string) => new Date(value).toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' });
}

'use client';
import { useMemo } from 'react';
import { asCallError, readOfferings, type GroupCallError } from '@/frontend/features/teacher-students/api';
import { useSwr } from '@/frontend/lib/use-swr';
import type { AdminOffering } from '@/shared/contracts/student-administration';
import { courseName } from '@/shared/teacher-students';

/**
 * The course title of each Group, by the id of the run it belongs to. The Groups read only names the run, and that name must never reach a teacher, so the title comes from the
 * same read the Students screen makes (same cache entry). Until it arrives, or if it fails, a Group simply shows no course line: nothing else stands in for it.
 */
export function useCourseTitles(): ReadonlyMap<string, string> {
  const { data } = useSwr<AdminOffering[], GroupCallError>('students:offerings', readOfferings, asCallError);
  return useMemo(() => new Map(data.state === 'ready' ? data.value.map(o => [o.id, courseName(o)]) : []), [data]);
}

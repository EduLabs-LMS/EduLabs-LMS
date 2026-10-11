/**
 * EduLabs v2 -> NEW LMS adapter. Pure presentation helpers; no Clerk, Prisma,
 * Supabase or session dependencies. 
 *
 * Lesson numbers are scoped to course_modules.id, NOT to a global
 * chapterType/chapterNumber pair. The caller must provide lessons in the
 * authenticated, authorized, deterministic display order from the repository.
 */
export type LessonCardStatus =
  | 'Published'
  | 'Not Started'
  | 'In Progress'
  | 'Completed'
  | 'Locked';

export type NumberableLesson = {
  id: string;
  module_id: string;
};

export function lessonNumbersByModule<T extends NumberableLesson>(
  orderedLessons: readonly T[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const numbers = new Map<string, number>();
  for (const lesson of orderedLessons) {
    if (!lesson.id || !lesson.module_id) {
      throw new Error('Lesson ID and parent module ID are required.');
    }
    if (numbers.has(lesson.id)) {
      throw new Error('Duplicate lesson ID in one course view.');
    }
    const next = (counts.get(lesson.module_id) ?? 0) + 1;
    counts.set(lesson.module_id, next);
    numbers.set(lesson.id, next);
  }
  return numbers;
}

/**
 * A missing offering means we may say "Published", not "Not Started" or
 * "Completed". Never merge progress from different course offerings.
 * An unfamiliar status is not proof of completion.
 */
export function lessonCardStatus(
  options: {
    published: boolean;
    offeringSelected: boolean;
    progressStatus?: string | null;
  },
): LessonCardStatus {
  if (!options.published) return 'Locked';
  if (!options.offeringSelected) return 'Published';
  switch (options.progressStatus) {
    case 'completed': return 'Completed';
    case 'in_progress': return 'In Progress';
    case null:
    case undefined:
    case 'not_started': return 'Not Started';
    default: return 'Published';
  }
}

/** An unnumbered module remains a module, not a global chapter bucket. */
export function moduleDisplayLabel(title: string | null | undefined, index: number): string {
  const cleaned = title?.trim();
  return cleaned || `Module ${index + 1}`;
}

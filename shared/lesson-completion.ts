/**
 * One lesson-completion rule for every student screen (owner, 2026-11-27): a lesson is complete when every published part is completed
 * AND every published homework of the lesson is handed in (late counts; any version of a family counts). A lesson with neither is complete
 * once opened. The database decides (public.lesson_completion); this file only lays its answer over the cards the pages already build.
 * Without an answer (the read failed or was not made) the cards keep the parts-only status they had.
 */
export type LessonCompletionRow = { offeringId: string; lessonId: string; parts: number; partsDone: number; homework: number; homeworkDone: number; complete: boolean; started: boolean };
export type LessonCompletion = Map<string, LessonCompletionRow>;
type Status = 'Completed' | 'In Progress' | 'Open Lesson' | 'Not Started' | 'Locked';

const key = (offeringId: string, lessonId: string) => `${offeringId}:${lessonId}`;

/** The rows of lesson_completion, checked; anything malformed is left out. */
export function completionMap(rows: unknown): LessonCompletion | undefined {
  if (!Array.isArray(rows)) return undefined;
  const map: LessonCompletion = new Map();
  for (const r of rows as Partial<LessonCompletionRow>[]) {
    if (!r || typeof r.offeringId !== 'string' || typeof r.lessonId !== 'string' || typeof r.complete !== 'boolean') continue;
    map.set(key(r.offeringId, r.lessonId), { offeringId: r.offeringId, lessonId: r.lessonId, parts: Number(r.parts) || 0, partsDone: Number(r.partsDone) || 0,
      homework: Number(r.homework) || 0, homeworkDone: Number(r.homeworkDone) || 0, complete: r.complete, started: Boolean(r.started) });
  }
  return map;
}

/** The status a card shows under the one rule: complete, started, or what it had (a card with no part says Locked until then). */
export function completedStatus<S extends Status | undefined>(status: S, row: LessonCompletionRow | undefined): S | Status {
  if (!row || status === undefined) return status;
  if (row.complete) return 'Completed';
  if (row.started || status === 'Completed') return 'In Progress';
  return status;
}

type Lesson = { id: string; status?: Status };
/** Lessons of one run's chapters (v2Chapters: chapter id `<offering>:<module>`, lesson id the lesson's id). */
export function chaptersWithCompletion<C extends { id?: string; lessons: Lesson[] }>(chapters: C[], completion: LessonCompletion | undefined): C[] {
  if (!completion) return chapters;
  return chapters.map(c => {
    const offeringId = c.id?.split(':')[0];
    if (!offeringId || offeringId === 'catalog') return c;
    return { ...c, lessons: c.lessons.map(l => ({ ...l, status: completedStatus(l.status, completion.get(key(offeringId, l.id))) })) };
  });
}
/** Lessons across runs (v2StudentLessons: lesson id `<offering>:<lesson>`). */
export function lessonsWithCompletion<L extends Lesson>(lessons: L[], completion: LessonCompletion | undefined): L[] {
  if (!completion) return lessons;
  return lessons.map(l => ({ ...l, status: completedStatus(l.status, completion.get(l.id)) }));
}

/** The one question every screen asks: does this card count as completed? The status already carries the rule; without one, the parts. */
export function lessonDone(lesson: { status?: Status; chapters: { isCompleted: boolean }[] }): boolean {
  if (lesson.status) return lesson.status === 'Completed';
  return lesson.chapters.length > 0 && lesson.chapters.every(c => c.isCompleted);
}

import type { SelfLearningChapter } from '@/shared/contracts/dashboard';

export type LessonFilter = 'all' | 'progress' | 'done' | 'new';
/** Same rule the lesson card uses to name a lesson's state. */
export function lessonState(lesson: { status?: string; chapters: { isCompleted: boolean }[] }): string {
  if (lesson.status) return lesson.status;
  if (lesson.chapters.length === 0) return 'Locked';
  if (lesson.chapters.every(c => c.isCompleted)) return 'Completed';
  if (lesson.chapters.some(c => c.isCompleted)) return 'In Progress';
  return 'Open Lesson';
}
const matches = (state: string, filter: LessonFilter) =>
  filter === 'all' || (filter === 'done' && state === 'Completed') || (filter === 'progress' && state === 'In Progress') || (filter === 'new' && (state === 'Open Lesson' || state === 'Not Started'));

/** Search by lesson or chapter title and filter by progress. A chapter whose title matches keeps all its lessons. Empty chapters are dropped. */
export function filterChapters(chapters: SelfLearningChapter[], query: string, filter: LessonFilter): SelfLearningChapter[] {
  const q = query.trim().toLowerCase();
  return chapters.flatMap(chapter => {
    const chapterHit = !!q && `${chapter.title} ${chapter.subtitle ?? ''}`.toLowerCase().includes(q);
    const lessons = chapter.lessons.filter(l => (!q || chapterHit || l.title.toLowerCase().includes(q)) && matches(lessonState(l), filter));
    return lessons.length ? [{ ...chapter, lessons }] : [];
  });
}
/** Share of finished lessons, 0 to 1. */
export function chapterProgress(chapter: Pick<SelfLearningChapter, 'lessons'>): number {
  if (!chapter.lessons.length) return 0;
  return chapter.lessons.filter(l => l.chapters.length > 0 && l.chapters.every(c => c.isCompleted)).length / chapter.lessons.length;
}

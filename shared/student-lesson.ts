// A student's lesson page addressed by the lesson id: pure decisions shared by the page and the tests. No React, no I/O.
import { continuePart, lessonPartHref } from '@/shared/contracts/lessons';

type Tree = {
  modules: { id: string; title: string }[];
  lessons: { id: string; module_id: string; title: string; status: string }[];
  segments: { id: string; lesson_id: string; position: number; status: string }[];
};
type Progress = Parameters<typeof continuePart>[1];

/** The lesson page: /courses/<course>/lessons/<lesson>?offering=<group>. */
export const lessonHref = (courseId: string, lessonId: string, offeringId: string) => `/courses/${courseId}/lessons/${lessonId}?offering=${offeringId}`;
/** The course page a student comes from. */
export const lessonPage = (courseId: string, offeringId: string) => `/courses/${courseId}?offering=${offeringId}`;

/**
 * What the lesson page shows. The tree is the student's own (published lessons and parts only, read under RLS after the group and enrollment
 * check): a lesson missing from it (a draft) is unavailable; a lesson with a published part opens that part (the one Continue Learning would);
 * a lesson without one is shown with its homework.
 */
export function lessonOverview(tree: Tree, progress: Progress, courseId: string, id: string, offeringId: string):
  { kind: 'unavailable' } | { kind: 'part'; href: string } | { kind: 'lesson'; title: string; module: string } {
  const lesson = tree.lessons.find(l => l.id === id && l.status === 'published');
  if (!lesson) return { kind: 'unavailable' };
  const parts = tree.segments.filter(s => s.lesson_id === id && s.status === 'published') as Parameters<typeof continuePart>[0];
  const part = parts.length ? continuePart(parts, progress, offeringId) : undefined;
  if (part) return { kind: 'part', href: lessonPartHref(courseId, part.id, offeringId) };
  return { kind: 'lesson', title: lesson.title, module: tree.modules.find(m => m.id === lesson.module_id)?.title ?? '' };
}

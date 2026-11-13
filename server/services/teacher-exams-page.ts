import 'server-only';
import type { WebsiteContext } from '@/server/services/website';
import { loadHomeworkPage } from '@/server/services/teacher-homework-page';
import type { ExamPageLoad } from '@/shared/teacher-exams';

/**
 * The courses the Exams page offers (course filter, the wizard's Course list) and whether the teacher seems able to author each one:
 * the same reading of the request's own context as Homework (course edit rights, owner's answer 12). This only chooses which buttons to
 * show; the routes and the database decide every write again.
 */
export function loadExamPage(context: WebsiteContext): ExamPageLoad {
  const load = loadHomeworkPage(context);
  if (load.state !== 'ready') return { state: 'error' };
  return { state: 'ready', courses: load.courses.map(c => ({ id: c.id, title: c.title, canEdit: c.canEdit, offerings: c.offerings.map(o => ({ id: o.id, name: o.name })) })) };
}

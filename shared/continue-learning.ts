import { lessonPartHref } from './contracts/lessons';

/** A projection of caller-scoped RLS reads, never a second progress store. */
export type ResumeScope = {
  limited: boolean;
  progressReadId?: string;
  progressReadProofs?: { key: string; revision: number }[];
  courses: { id: string; organization_id: string; title: string; status: string }[];
  offerings: { id: string; course_id: string; name: string; status: string }[];
  enrollments: { offering_id: string; status: string; enrolled_at: string | null; expires_at: string | null }[];
  modules: { id: string; course_id: string; position: number }[];
  lessons: { id: string; module_id: string; title: string; status: string; position: number }[];
  segments: { id: string; lesson_id: string; title: string; status: string; position: number }[];
  progress: { offering_id: string; lesson_id: string; last_accessed_at: string | null }[];
  segmentProgress: { offering_id: string; lesson_id: string; segment_id: string; status: string; video_position_seconds: number; updated_at: string }[];
};
export type ResumeItem = {
  offeringId: string; lessonId: string; courseTitle: string; offeringName: string;
  lessonTitle: string; partTitle: string; href: string; position: number;
  completedParts: number; totalParts: number;
};
export type ResumeLearning = { items: ResumeItem[]; unavailable: boolean; readId?: string; proofs?: { key: string; revision: number }[] };
const timestamp = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
};
const key = (offering: string, id: string) => `${offering}:${id}`;

/** Last *saved study activity*, not page visits. Never rank by content.updated_at.
 * Null/invalid historic activity falls behind dated saves, then stable IDs.
 * No signed URLs, private content, or new progress writes are produced here. */
export function resumeLearning(scope: ResumeScope, organizations: { id: string; status: string }[], now = Date.now(), offeringId?: string): ResumeLearning {
  if (scope.limited) return { items: [], unavailable: true, readId: scope.progressReadId, proofs: scope.progressReadProofs };
  const activeOrgs = new Set(organizations.filter(o => o.status === 'active').map(o => o.id));
  const courses = new Map(scope.courses.filter(c => c.status === 'published' && activeOrgs.has(c.organization_id)).map(c => [c.id, c]));
  const modules = new Map(scope.modules.map(m => [m.id, m]));
  const lessons = new Map(scope.lessons.filter(l => l.status === 'published').map(l => [l.id, l]));
  const enrolled = new Set(scope.enrollments.filter(e => e.status === 'active' &&
    (!e.enrolled_at || (Number.isFinite(Date.parse(e.enrolled_at)) && Date.parse(e.enrolled_at) <= now)) &&
    (!e.expires_at || (Number.isFinite(Date.parse(e.expires_at)) && Date.parse(e.expires_at) > now))).map(e => e.offering_id));
  // Offering ends_at intentionally does not revoke an existing active enrollment.
  const offerings = new Map(scope.offerings.filter(o => o.status === 'active' && enrolled.has(o.id) && courses.has(o.course_id) && (!offeringId || o.id === offeringId)).map(o => [o.id, o]));
  const parts = new Map<string, ResumeScope['segments']>();
  for (const s of scope.segments) if (s.status === 'published' && lessons.has(s.lesson_id)) {
    const list = parts.get(s.lesson_id) ?? []; list.push(s); parts.set(s.lesson_id, list);
  }
  for (const list of Array.from(parts.values())) list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const progress = new Map(scope.segmentProgress.map(p => [key(p.offering_id, p.segment_id), p]));
  const activity = new Map(scope.progress.map(p => [key(p.offering_id, p.lesson_id), timestamp(p.last_accessed_at)]));
  const candidates: (ResumeItem & { activity: number })[] = [];
  for (const o of Array.from(offerings.values())) for (const [lessonId, segments] of Array.from(parts.entries())) {
    const lesson = lessons.get(lessonId)!, courseModule = modules.get(lesson.module_id);
    if (!courseModule || courseModule.course_id !== o.course_id) continue;
    const mine = segments.map(s => progress.get(key(o.id, s.id))).filter(p => p && p.lesson_id === lessonId && ['in_progress', 'completed'].includes(p.status));
    if (!mine.length) continue; // Stale/unpublished-only progress never becomes a recommendation.
    const completed = new Set(mine.filter(p => p?.status === 'completed').map(p => p!.segment_id));
    const unfinished = segments.filter(s => !completed.has(s.id));
    if (!unfinished.length) continue; // Derive completion from current published parts, not cached totals.
    const started = unfinished.filter(s => { const p = progress.get(key(o.id, s.id)); return p?.lesson_id === lessonId && p.status === 'in_progress'; });
    started.sort((a, b) => timestamp(progress.get(key(o.id, b.id))?.updated_at) - timestamp(progress.get(key(o.id, a.id))?.updated_at) || a.position - b.position || a.id.localeCompare(b.id));
    const next = started[0] ?? unfinished[0], saved = progress.get(key(o.id, next.id));
    candidates.push({ offeringId: o.id, lessonId, courseTitle: courses.get(o.course_id)!.title, offeringName: o.name,
      lessonTitle: lesson.title, partTitle: next.title, href: lessonPartHref(o.course_id, next.id, o.id),
      position: saved && saved.lesson_id === lessonId && Number.isFinite(saved.video_position_seconds) ? Math.max(0, Math.floor(saved.video_position_seconds)) : 0,
      completedParts: completed.size, totalParts: segments.length, activity: activity.get(key(o.id, lessonId)) ?? 0 });
  }
  candidates.sort((a, b) => b.activity - a.activity || a.offeringId.localeCompare(b.offeringId) || a.lessonId.localeCompare(b.lessonId));
  return { unavailable: false, readId: scope.progressReadId, proofs: scope.progressReadProofs, items: candidates.slice(0, 3).map(({ activity: _activity, ...item }) => item) };
}

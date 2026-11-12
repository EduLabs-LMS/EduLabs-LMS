import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { homeworkService } from '@/server/services/homework';
import { editableTeacherCourse } from '@/server/services/teacher-course';
import type { Json } from '@/shared/contracts/database.types';
import type { HomeworkLifecycle, HomeworkSave } from '@/shared/contracts/teacher-homework';
import { homeworkReply, type PortalTab } from '@/shared/teacher-homework';

export type HomeworkResult = { status: number; body: unknown };
const denied: HomeworkResult = { status: 404, body: { kind: 'denied' } };
const BUCKET = 'lms-homework';

/**
 * Everything here runs as the signed-in teacher (the RLS-bound server client; no service role). The checks before each write only spare the
 * database a call it would refuse: every function authorizes again, under its own lock, from private.current_app_user_id().
 */
export async function readPortal(courseId: string | null, tab: PortalTab, page: number): Promise<HomeworkResult> {
  const client = await getSupabaseServerClient();
  const { data, error } = await client.rpc('homework_portal', { p_course: courseId, p_tab: tab, p_page: page });
  if (error) return homeworkReply(error);
  return { status: 200, body: data };
}

/** One homework for the wizard. get_homework decides visibility; a student reading it here is told no (this route is for staff). */
export async function readHomework(id: string): Promise<HomeworkResult> {
  const client = await getSupabaseServerClient();
  const { data, error } = await client.rpc('get_homework', { p_assignment: id, p_submission: null });
  if (error) return homeworkReply(error);
  const view = data as { staff?: unknown } | null;
  if (!view || view.staff !== true) return denied;
  const course = await client.from('homework_assignments').select('course_id').eq('id', id).maybeSingle();
  return { status: 200, body: { ...(view as object), courseId: course.data?.course_id ?? null } };
}

async function courseOfOffering(offeringId: string) {
  const client = await getSupabaseServerClient();
  const { data } = await client.from('course_offerings').select('course_id').eq('id', offeringId).maybeSingle();
  return data?.course_id ?? null;
}
async function spaceOfCourse(courseId: string) {
  const client = await getSupabaseServerClient();
  const { data } = await client.from('courses').select('organization_id').eq('id', courseId).maybeSingle();
  return data?.organization_id ?? null;
}
async function courseOfHomework(id: string) {
  const client = await getSupabaseServerClient();
  const { data } = await client.from('homework_assignments').select('course_id').eq('id', id).maybeSingle();
  return data?.course_id ?? null;
}

/**
 * Save the wizard (a new draft when id is null). The reply carries the new revision from a fresh read, so the next autosave sends it.
 * A save may move the homework to another lesson or course: the caller must edit the course it goes to and the course it is in now. The
 * database checks both again and refuses a move once a student started ({"reason":"started"}) or for a later version ({"reason":"versioned"}).
 * A move stays inside one teaching space: a course in another space is refused here, before the write, with {"reason":"other_space"}, even
 * for a teacher who edits both (the database refuses it too).
 */
export async function saveHomework(userId: string, id: string | null, input: HomeworkSave): Promise<HomeworkResult> {
  const courseId = await courseOfOffering(input.offeringId);
  if (!courseId || !await editableTeacherCourse(userId, courseId)) return denied;
  if (id) {
    const from = await courseOfHomework(id);
    if (!from || (from !== courseId && !await editableTeacherCourse(userId, from))) return denied;
    if (from !== courseId) {
      const [here, there] = await Promise.all([spaceOfCourse(from), spaceOfCourse(courseId)]);
      if (here !== there) return { status: 409, body: { kind: 'refused', reason: 'other_space' } };
    }
  }
  const client = await getSupabaseServerClient();
  const { data, error } = await client.rpc('save_homework', { p_assignment: id, p_offering: input.offeringId, p_lesson: input.lessonId, p_segment: null, p_revision: input.revision, p_definition: input.definition as unknown as Json, p_confirm_mode_change: false });
  if (error) return homeworkReply(error);
  const saved = String(data);
  const fresh = await client.rpc('get_homework', { p_assignment: saved, p_submission: null });
  const revision = (fresh.data as { revision?: unknown } | null)?.revision;
  return { status: 200, body: { id: saved, revision: typeof revision === 'number' ? revision : null } };
}

/** Publish, unpublish, clone (a new version once students started) and reschedule (a new deadline, no new version). */
export async function homeworkLifecycle(userId: string, id: string, input: HomeworkLifecycle): Promise<HomeworkResult> {
  const courseId = await courseOfHomework(id);
  if (!courseId || !await editableTeacherCourse(userId, courseId)) return denied;
  const service = await homeworkService();
  const data = input.action === 'reschedule' ? { deadline: input.deadline, lateAllowed: input.lateAllowed } : {};
  const { data: next, error } = await service.client.rpc('homework_lifecycle', { p_assignment: id, p_action: input.action, p_revision: input.revision, p_data: data as Json });
  if (error) return homeworkReply(error);
  const nextId = String(next);
  // A clone's solution files are copied by the existing clone flow; if that fails the draft says so in the wizard (mediaCopyPending).
  if (input.action === 'clone') { try { await service.copyCloneMedia(nextId); } catch { return { status: 200, body: { id: nextId, mediaCopyPending: true } }; } }
  return { status: 200, body: { id: nextId } };
}

/**
 * Delete images of a closed homework. homework_delete_images (managers only, after the deadline) marks the student photos 'deleted' and
 * returns their paths; then the objects are removed through the Storage API with the same signed-in client, which the storage policy
 * allows for a 'deleted' submission photo and a manager of that homework. SQL never deletes an object. If the removal fails, or removes
 * fewer objects than listed, the rows stay 'deleted' (grades, marks, notes and answers are untouched either way), private.expired_homework_uploads
 * still lists them, and `node scripts/lms-storage-maintenance.cjs` removes them on its next run. A path outside this homework is never sent.
 */
export async function deleteHomeworkImages(id: string): Promise<HomeworkResult> {
  const client = await getSupabaseServerClient();
  const { data, error } = await client.rpc('homework_delete_images', { p_assignment: id });
  if (error) return homeworkReply(error);
  const result = data as { deletedFiles?: unknown; bytesFreed?: unknown; paths?: unknown } | null;
  const paths = Array.isArray(result?.paths) ? (result?.paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.startsWith(`${id}/`) && !p.includes('..')) : [];
  let removed = 0, storage: 'done' | 'retry' = 'done';
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    try {
      const r = await client.storage.from(BUCKET).remove(chunk);
      if (r.error) { storage = 'retry'; console.error('Homework image removal deferred to maintenance', { files: chunk.length }); continue; }
      removed += r.data?.length ?? 0;
    } catch { storage = 'retry'; console.error('Homework image removal deferred to maintenance', { files: chunk.length }); }
  }
  return { status: 200, body: { deletedFiles: typeof result?.deletedFiles === 'number' ? result.deletedFiles : 0, bytesFreed: typeof result?.bytesFreed === 'number' ? result.bytesFreed : 0, filesRemoved: removed, storage } };
}

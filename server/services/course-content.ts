import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { editableTeacherCourse } from '@/server/services/teacher-course';
import type { Json } from '@/shared/contracts/database.types';
import type { ContentEdit } from '@/shared/contracts/course-content';
import { contentCall, contentReply, type CourseStructure } from '@/shared/course-content';

export type ContentResult = { status: number; body: Record<string, unknown> | CourseStructure };

/** The signed-in person's read: public.course_structure decides who may see it (an assistant may read, and is told canEdit false). */
export async function readCourseStructure(courseId: string): Promise<ContentResult> {
  const client = await getSupabaseServerClient();
  const { data, error } = await client.rpc('course_structure', { p_course_id: courseId });
  if (error) return contentReply(error);
  return { status: 200, body: data as unknown as CourseStructure };
}

/**
 * One change, then a fresh read, so the screen always holds the versions the server now has. The same check as every other teacher write runs first; the database function
 * then authorizes again and locks the course. A failed read after a saved change is not a failed change: the reply says it was saved and gives no tree, so the screen reads again.
 */
export async function applyContentEdit(userId: string, courseId: string, edit: ContentEdit): Promise<ContentResult> {
  if (!await editableTeacherCourse(userId, courseId)) return { status: 404, body: { kind: 'denied' } };
  const client = await getSupabaseServerClient();
  const call = contentCall(courseId, edit);
  const { data, error } = call.fn === 'edit_course_structure'
    ? await client.rpc('edit_course_structure', { ...call.args, p_data: call.args.p_data as Json })
    : await client.rpc('edit_learning_content', { ...call.args, p_data: call.args.p_data as Json });
  if (error) return contentReply(error);
  const read = await readCourseStructure(courseId).catch(() => null);
  return { status: 200, body: { id: data, structure: read?.status === 200 ? read.body : null } };
}

import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { groupFailure } from '@/server/services/groups';
import { currentRun } from '@/shared/teacher-groups';

const unavailable = 'Groups are unavailable or require the approved database update.';

/**
 * A new Group needs its course's current run. Reads and the insert run as the signed-in caller,
 * so the existing course_offerings rules decide who may; nothing here is privileged.
 */
export async function groupCourseRun(courseId: string) {
  const client = await getSupabaseServerClient();
  const course = await client.from('courses').select('id,title').eq('id', courseId).maybeSingle();
  if (course.error) throw groupFailure(unavailable, 503);
  if (!course.data) throw groupFailure('Group unavailable or permission denied.', 403);
  const runs = await client.from('course_offerings').select('id,course_id,status,starts_at,ends_at').eq('course_id', courseId).limit(101);
  if (runs.error) throw groupFailure(unavailable, 503);
  const run = currentRun(runs.data ?? [], courseId, Date.now());
  if (run) return { offeringId: run.id };
  // The id is set here and the row is not read back in the same statement: the read rule cannot see a row its own statement is adding.
  const offeringId = crypto.randomUUID();
  const created = await client.from('course_offerings').insert({ id: offeringId, course_id: courseId, name: course.data.title, delivery_mode: 'scheduled', status: 'active' });
  if (created.error) throw created.error.code === '42501' ? groupFailure('Group unavailable or permission denied.', 403) : groupFailure(unavailable, 503);
  return { offeringId };
}

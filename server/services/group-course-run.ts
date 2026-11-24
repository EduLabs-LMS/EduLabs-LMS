import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { groupFailure } from '@/server/services/groups';

const unavailable = 'Groups are unavailable or require the approved database update.';

/**
 * A new Group needs its course's current run. public.course_run returns the current run or makes it under a lock on the course row,
 * so two Groups created at once get ONE run. It runs as the signed-in caller and decides who may; nothing here is privileged and
 * the browser role has no direct write on course_offerings.
 */
export async function groupCourseRun(courseId: string) {
  const client = await getSupabaseServerClient();
  const run = await client.rpc('course_run', { p_course_id: courseId });
  if (run.error) {
    if (run.error.code === '42501') throw groupFailure('Group unavailable or permission denied.', 403);
    if (run.error.code === '23514') throw groupFailure('An archived course cannot get a new Group.', 409);
    throw groupFailure(unavailable, 503);
  }
  if (typeof run.data !== 'string') throw groupFailure(unavailable, 503);
  return { offeringId: run.data };
}

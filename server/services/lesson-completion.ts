import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { completionMap, type LessonCompletion } from '@/shared/lesson-completion';

/**
 * The one lesson-completion rule (owner, 2026-11-27) for the caller's own runs: public.lesson_completion, which reads only the caller's rows.
 * Nothing to ask, too many runs, or a failed read gives undefined, and the cards keep their parts-only status: it never blocks a page.
 */
export async function lessonCompletion(scope: { progressLimited: boolean; offerings: { id: string }[]; enrollments: { offering_id: string; status: string; enrolled_at: string | null; expires_at: string | null }[] }): Promise<LessonCompletion | undefined> {
  if (scope.progressLimited) return undefined;
  const now = Date.now();
  const mine = scope.offerings.filter(o => scope.enrollments.some(e => e.offering_id === o.id && e.status === 'active' && (!e.expires_at || Date.parse(e.expires_at) > now) && (!e.enrolled_at || Date.parse(e.enrolled_at) <= now))).map(o => o.id);
  if (!mine.length || mine.length > 100) return undefined;
  try {
    const { data, error } = await (await getSupabaseServerClient()).rpc('lesson_completion', { p_offerings: mine });
    return error ? undefined : completionMap(data);
  } catch { return undefined; }
}

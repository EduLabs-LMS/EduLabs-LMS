import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { reportReply } from '@/shared/teacher-reports';

export type ReportResult = { status: number; body: unknown };

/**
 * Reports are READ-ONLY and run as the signed-in teacher (the RLS-bound server client; no service role). Every report function resolves the
 * caller with private.current_app_user_id() and authorizes again: owners, instructors and the run's assistants (a course editor also reads the
 * course Results); students and other spaces get 42501, which is answered as "denied", never with the database's message.
 */
async function rpc(name: 'report_groups' | 'report_group' | 'report_attention' | 'report_student' | 'report_course', args: Record<string, unknown>): Promise<ReportResult> {
  const client = await getSupabaseServerClient();
  const { data, error } = await (client.rpc as unknown as (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>)(name, args);
  if (error) return reportReply(error);
  return { status: 200, body: data };
}

/** The Groups list: the numbers of the Groups on screen, this month. One call. */
export const readGroupsReport = (groups: string[]) => rpc('report_groups', { p_groups: groups });
/** The Report tab of one Group: this month (no month), an earlier month, or 'all'. */
export const readGroupReport = (group: string, month: string | null) => rpc('report_group', { p_group: group, p_month: month });
/** The Needs attention list of the Students screen: this month, one course or every course the teacher supports. */
export const readAttention = (offering: string | null, page: number) => rpc('report_attention', { p_offering: offering, p_page: page });
/** One student in one course. */
export const readStudentReport = (student: string, offering: string, month: string | null) => rpc('report_student', { p_student: student, p_offering: offering, p_month: month });
/** The Results of a course page. */
export const readCourseReport = (course: string, month: string | null) => rpc('report_course', { p_course: course, p_month: month });

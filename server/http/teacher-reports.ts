import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, reply, sameOriginRead, signedIn } from '@/server/http/teacher-exams';
import { readAttention, readCourseReport, readGroupReport, readGroupsReport, readStudentReport, type ReportResult } from '@/server/services/teacher-reports';
import { isFirebaseStaging } from '@/shared/auth-config';
import { attentionQuery, courseReportQuery, groupReportQuery, groupsQuery, studentReportQuery } from '@/shared/contracts/teacher-reports';

const id = z.string().uuid();
type One = { params: Promise<{ groupId: string }> } | { params: Promise<{ studentId: string }> } | { params: Promise<{ courseId: string }> };
const send = (result: ReportResult) => reply(result.body, result.status);

/** Every report is a same-origin GET: staging only, then its parameters (a bad one is 400 before anyone is asked who they are), then sign-in. */
async function read<P>(request: NextRequest, parse: () => Promise<P | null>, run: (p: P) => Promise<NextResponse>) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!sameOriginRead(request)) return reply({ kind: 'denied' }, 403);
  const p = await parse();
  if (p === null) return reply({ kind: 'invalid' }, 400);
  try {
    if (!await signedIn()) return reply({ kind: 'signin' }, 401);
    return await run(p);
  } catch { return reply({ kind: 'failed' }, 503); }
}
async function idOf(context: One, name: 'groupId' | 'studentId' | 'courseId'): Promise<string | null> {
  const raw = (await context.params as Record<string, string>)[name];
  const parsed = id.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** GET /api/teacher/reports/groups?groups=a,b : the Groups list line (report_groups). */
export const reportGroupsGET = (request: NextRequest) =>
  read(request, async () => {
    const raw = request.nextUrl.searchParams.getAll('groups');
    if (raw.length !== 1 || request.nextUrl.searchParams.size !== 1) return null;
    const parsed = groupsQuery.safeParse({ groups: raw[0] });
    return parsed.success ? parsed.data : null;
  }, async groups => send(await readGroupsReport(groups)));

/** GET /api/teacher/reports/groups/<id>?month= : the Report tab of one Group (report_group). */
export const reportGroupGET = (request: NextRequest, context: { params: Promise<{ groupId: string }> }) =>
  read(request, async () => { const group = await idOf(context, 'groupId'), q = query(request, groupReportQuery); return group && q ? { group, month: q.month ?? null } : null; },
    async ({ group, month }) => send(await readGroupReport(group, month)));

/** GET /api/teacher/reports/attention?course=&page= : the Needs attention filter (report_attention). */
export const reportAttentionGET = (request: NextRequest) =>
  read(request, async () => query(request, attentionQuery), async q => send(await readAttention(q.course ?? null, q.page)));

/** GET /api/teacher/reports/students/<id>?course=&month= : one student in one course (report_student). */
export const reportStudentGET = (request: NextRequest, context: { params: Promise<{ studentId: string }> }) =>
  read(request, async () => { const student = await idOf(context, 'studentId'), q = query(request, studentReportQuery); return student && q ? { student, course: q.course, month: q.month ?? null } : null; },
    async ({ student, course, month }) => send(await readStudentReport(student, course, month)));

/** GET /api/teacher/reports/courses/<id>?month= : the Results of a course (report_course). */
export const reportCourseGET = (request: NextRequest, context: { params: Promise<{ courseId: string }> }) =>
  read(request, async () => { const course = await idOf(context, 'courseId'), q = query(request, courseReportQuery); return course && q ? { course, month: q.month ?? null } : null; },
    async ({ course, month }) => send(await readCourseReport(course, month)));

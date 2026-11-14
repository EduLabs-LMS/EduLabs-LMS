import 'server-only';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { query, readBody, reply, sameOriginRead, signedIn } from '@/server/http/teacher-exams';
import { readStudentExam, readStudentExams, studentUpload, studentWork } from '@/server/services/exams-student';
import type { ExamResult } from '@/server/services/teacher-exams';
import { isFirebaseStaging } from '@/shared/auth-config';
import { examStudentWork, examViewQuery, studentUpload as uploadBody } from '@/shared/contracts/exams-student';

type Context = { params: Promise<{ examId: string }> };
const id = z.string().uuid();
/** A saved answer or a hand-in is small; a text answer is at most 10 000 characters. */
export const STUDENT_EXAM_LIMITS = { work: 24000, small: 2048 } as const;
const send = (result: ExamResult) => reply(result.body, result.status);
async function examOf(context: Context): Promise<string | null> {
  const parsed = id.safeParse((await context.params).examId);
  return parsed.success ? parsed.data : null;
}

/** GET /api/exams : the student's exams (exam_student_list). Staging, same origin, then who is asking; no parameters. */
export async function studentExamsGET(request: NextRequest) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!sameOriginRead(request)) return reply({ kind: 'denied' }, 403);
  if (request.nextUrl.searchParams.size !== 0) return reply({ kind: 'invalid' }, 400);
  try {
    if (!await signedIn()) return reply({ kind: 'signin' }, 401);
    return send(await readStudentExams());
  } catch { return reply({ kind: 'failed' }, 503); }
}

/** GET /api/exams/<id>?attempt=<try> : one exam as its student sees it (exam_get), with one try when asked. A staff view is refused. */
export async function studentExamGET(request: NextRequest, context: Context) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!sameOriginRead(request)) return reply({ kind: 'denied' }, 403);
  const exam = await examOf(context), q = query(request, examViewQuery);
  if (!exam || !q) return reply({ kind: 'invalid' }, 400);
  try {
    if (!await signedIn()) return reply({ kind: 'signin' }, 401);
    return send(await readStudentExam(exam, q.attempt ?? null));
  } catch { return reply({ kind: 'failed' }, 503); }
}

async function write<B>(request: NextRequest, context: Context, schema: z.ZodType<B>, limit: number, run: (examId: string, body: B) => Promise<ExamResult>) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!validFirebaseOrigin(request)) return reply({ kind: 'denied' }, 403);
  const exam = await examOf(context);
  if (!exam) return reply({ kind: 'invalid' }, 400);
  try {
    if (!await signedIn()) return reply({ kind: 'signin' }, 401);
    const body = await readBody(request, schema, limit);
    if ('failure' in body) return body.failure;
    return send(await run(exam, body.data));
  } catch { return reply({ kind: 'failed' }, 503); }
}

/** POST /api/exams/<id>/work : start, retry (second try), save one answer, or submit. */
export const studentExamWorkPOST = (request: NextRequest, context: Context) => write(request, context, examStudentWork, STUDENT_EXAM_LIMITS.work, studentWork);

/** POST /api/exams/<id>/upload : a place for a photo answer (intent), the server's byte check (complete), or a signed link (get). */
export const studentExamUploadPOST = (request: NextRequest, context: Context) => write(request, context, uploadBody, STUDENT_EXAM_LIMITS.small, studentUpload);

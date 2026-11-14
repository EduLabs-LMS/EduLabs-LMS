import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { examUpload, type ExamResult } from '@/server/services/teacher-exams';
import type { Json } from '@/shared/contracts/database.types';
import type { ExamStudentWork, StudentUpload } from '@/shared/contracts/exams-student';
import { studentReply } from '@/shared/exams-student';

const denied: ExamResult = { status: 404, body: { kind: 'denied' } };

/**
 * Everything here runs as the signed-in student (the RLS-bound server client; no service role, no user id sent). Every exam function
 * resolves the caller from private.current_app_user_id() and decides again, under its own lock: enrollment, the window, the clock, the tries,
 * what is kept from a first try and what may be shown (answer keys only once review is open). The only checks here keep a staff view and
 * a malformed answer away from a student's screen.
 */
async function rpc(name: 'exam_student_list' | 'exam_get' | 'exam_work' | 'exam_upload', args: Record<string, unknown>): Promise<ExamResult> {
  const client = await getSupabaseServerClient();
  const { data, error } = await (client.rpc as unknown as (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string; details?: string } | null }>)(name, args);
  if (error) return studentReply(error);
  return { status: 200, body: data };
}

/** The student's exams (exam_student_list): every run they are enrolled in, with their own window, try state and released result. */
export const readStudentExams = () => rpc('exam_student_list', {});

/**
 * One exam as its student sees it (exam_get), with one of their tries when asked. A staff view carries answer keys: a person who may also
 * author or correct this exam is sent to the teacher screens, and this route answers as if there were nothing here.
 */
export async function readStudentExam(id: string, attemptId: string | null): Promise<ExamResult> {
  const read = await rpc('exam_get', { p_exam: id, p_attempt: attemptId });
  if (read.status !== 200) return read;
  const view = read.body as { staff?: unknown } | null;
  if (!view || view.staff !== false) return denied;
  return read;
}

/**
 * Start, second try, save one answer, hand in. A save names the try's revision (the database refuses a stale one) and exactly one kind of
 * answer; the reply carries the time the database saved it. After the deadline the database has already handed the try in: its auto-submit wins.
 */
export function studentWork(id: string, input: ExamStudentWork): Promise<ExamResult> {
  if (input.action === 'start' || input.action === 'retry') return rpc('exam_work', { p_exam: id, p_action: input.action, p_revision: null, p_data: {} });
  if (input.action === 'submit') return rpc('exam_work', { p_exam: id, p_action: 'submit', p_revision: input.revision, p_data: { attemptId: input.attemptId } });
  const data: Record<string, unknown> = { attemptId: input.attemptId, questionId: input.questionId };
  if (input.optionIds !== undefined) data.optionIds = input.optionIds;
  if (input.numberValue !== undefined) data.numberValue = input.numberValue;
  if (input.text !== undefined) data.text = input.text;
  if (input.uploadId !== undefined) data.uploadId = input.uploadId;
  return rpc('exam_work', { p_exam: id, p_action: 'save', p_revision: input.revision, p_data: data as Json });
}

/**
 * A photo answer, the homework way on lms-exams: a place in this try (intent), the bytes straight to Storage as the signed-in student (the
 * policy lets them write only their own pending path), then the server's byte check (complete) and a five-minute signed link (get).
 */
export function studentUpload(id: string, input: StudentUpload): Promise<ExamResult> {
  if (input.action === 'intent') return rpc('exam_upload', { p_exam: id, p_action: 'intent', p_id: null, p_data: { purpose: 'answer', attemptId: input.attemptId, mime: input.mime, name: input.name } });
  return examUpload(id, input);
}

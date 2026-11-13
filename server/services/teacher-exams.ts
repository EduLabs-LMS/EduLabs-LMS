import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { getFirebaseAdminAuth } from '@/server/integrations/firebase-admin';
import { getFirebaseSession } from '@/server/services/firebase-auth';
import { validateHomeworkBytes } from '@/server/services/homework-file-validation';
import { editableTeacherCourse } from '@/server/services/teacher-course';
import { getSupabaseConfig } from '@/shared/supabase-config';
import type { Database, Json } from '@/shared/contracts/database.types';
import type { ExamLifecycle, ExamPaperMarks, ExamReleaseMany, ExamSave, ExamUpload, ExamWindowInput, ExamWork } from '@/shared/contracts/teacher-exams';
import { examReply, type ExamTab, type QueueTab } from '@/shared/teacher-exams';

export type ExamResult = { status: number; body: unknown };
const denied: ExamResult = { status: 404, body: { kind: 'denied' } };
const BUCKET = 'lms-exams', PICTURE_LIMIT = 5 * 1024 * 1024;
const ok = (body: unknown): ExamResult => ({ status: 200, body });

/**
 * Everything here runs as the signed-in teacher (the RLS-bound server client; no service role). Every exam function authorizes again,
 * under its own lock, from private.current_app_user_id(): authoring is course edit rights, correcting and releasing are the 'correct' and
 * 'release' rights (managers, and assistants whose right is on), which the server cannot see. The only check here spares the database a
 * create it would refuse.
 */
async function rpc(name: 'exam_portal' | 'exam_get' | 'exam_save' | 'exam_lifecycle' | 'exam_set_window' | 'exam_work' | 'exam_release_many' | 'exam_paper_mark' | 'exam_queue' | 'exam_paper_sheet' | 'exam_upload', args: Record<string, unknown>): Promise<ExamResult> {
  const client = await getSupabaseServerClient();
  const { data, error } = await (client.rpc as unknown as (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string; details?: string } | null }>)(name, args);
  if (error) return examReply(error);
  return ok(data);
}

/** GET the Exams page: one tab of one course or every course (exam_portal). */
export const readExamPortal = (courseId: string | null, tab: ExamTab, page: number) => rpc('exam_portal', { p_course: courseId, p_tab: tab, p_page: page });

/** One exam for its staff (exam_get): a student reading it here is told no (these routes are for staff). With an attempt: that try too. */
export async function readExam(id: string, attemptId: string | null = null): Promise<ExamResult> {
  const read = await rpc('exam_get', { p_exam: id, p_attempt: attemptId });
  if (read.status !== 200) return read;
  const view = read.body as { staff?: unknown; attempt?: unknown } | null;
  if (!view || view.staff !== true || (attemptId !== null && !view.attempt)) return denied;
  return read;
}

async function courseOfOffering(offeringId: string) {
  const client = await getSupabaseServerClient();
  const { data } = await client.from('course_offerings').select('course_id').eq('id', offeringId).maybeSingle();
  return data?.course_id ?? null;
}

/** Save the wizard: a new exam (id null: its run and kind) or the revision the screen read. An exam keeps its run and kind. */
export async function saveExam(userId: string, id: string | null, input: ExamSave): Promise<ExamResult> {
  if (id === null) {
    if (!input.offeringId || !input.definition.kind) return { status: 400, body: { kind: 'invalid' } };
    const courseId = await courseOfOffering(input.offeringId);
    if (!courseId || !await editableTeacherCourse(userId, courseId)) return denied;
  }
  return rpc('exam_save', { p_exam: id, p_offering: input.offeringId, p_revision: input.revision, p_definition: input.definition as unknown as Json });
}

/** Publish, unpublish, archive, clone (Duplicate, and a new version of a started exam) and reschedule (the times only). */
export function examLifecycle(id: string, input: ExamLifecycle): Promise<ExamResult> {
  const data = input.action === 'clone' ? (input.offeringId ? { offeringId: input.offeringId } : {}) : input.action === 'reschedule' ? input.times : {};
  return rpc('exam_lifecycle', { p_exam: id, p_action: input.action, p_revision: input.revision, p_data: data as Json });
}

/** One Group's window: its linked session again (auto), another coming session of that Group (picked), or a time (custom). */
export function setExamWindow(id: string, input: ExamWindowInput): Promise<ExamResult> {
  const data = input.source === 'auto' ? { source: 'auto' } : input.source === 'picked' ? { source: 'picked', sessionId: input.sessionId } : { source: 'custom', opensAt: input.opensAt, closesAt: input.closesAt };
  return rpc('exam_set_window', { p_exam: id, p_group: input.groupId, p_revision: input.revision, p_data: data as Json });
}

/** The magic bytes of the three picture types lms-exams takes. */
function pictureType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && String.fromCharCode(...Array.from(bytes.slice(0, 4))) === 'RIFF' && String.fromCharCode(...Array.from(bytes.slice(8, 12))) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Question and model answer pictures (the homework upload flow, on lms-exams). intent: a pending row and its path (authors, before any
 * work). complete: the server reads the stored bytes as the uploader (the storage policy lets them read their own pending upload), decodes
 * the picture, and proves size and hash to the database with a short-lived, upload-scoped token (claim exam_upload, never sent to the
 * browser). get: a five-minute signed link of a ready picture the caller may see.
 */
export async function examUpload(id: string, input: ExamUpload): Promise<ExamResult> {
  if (input.action === 'intent') return rpc('exam_upload', { p_exam: id, p_action: 'intent', p_id: null, p_data: { purpose: input.purpose, mime: input.mime, name: input.name } });
  const client = await getSupabaseServerClient();
  if (input.action === 'get') {
    const got = await rpc('exam_upload', { p_exam: id, p_action: 'get', p_id: input.id, p_data: {} });
    if (got.status !== 200) return got;
    const v = got.body as { path?: unknown; name?: unknown; mime?: unknown } | null;
    if (!v || typeof v.path !== 'string') return denied;
    const signed = await client.storage.from(BUCKET).createSignedUrl(v.path, 300);
    if (signed.error || !signed.data) return { status: 403, body: { kind: 'denied' } };
    return ok({ id: input.id, name: typeof v.name === 'string' ? v.name : '', mime: typeof v.mime === 'string' ? v.mime : '', url: signed.data.signedUrl });
  }
  // complete: the path is the one exam_upload gave at intent (<exam>/<upload>/file); nothing outside this exam is read.
  const path = `${id}/${input.id}/file`;
  const stored = await client.storage.from(BUCKET).download(path);
  if (stored.error || !stored.data) return { status: 403, body: { kind: 'denied' } };
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  if (bytes.length > PICTURE_LIMIT) return { status: 413, body: { kind: 'too_large' } };
  const mime = pictureType(bytes);
  if (!mime) return { status: 400, body: { kind: 'invalid', reason: 'file_type' } };
  try { await validateHomeworkBytes(bytes, mime); } catch { return { status: 400, body: { kind: 'invalid', reason: 'file_type' } }; }
  const session = await getFirebaseSession();
  if (!session || !session.identity.email_verified) return { status: 401, body: { kind: 'signin' } };
  const token = await getFirebaseAdminAuth().createCustomToken(session.identity.uid, { role: 'authenticated', exam_upload: { id: input.id, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
  const exchange = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, returnSecureToken: true }), cache: 'no-store' });
  const payload = await exchange.json().catch(() => null) as { idToken?: unknown } | null;
  if (!exchange.ok || typeof payload?.idToken !== 'string') { console.error('Exam upload attestation exchange rejected', { status: exchange.status }); return { status: 503, body: { kind: 'failed' } }; }
  const idToken = payload.idToken;
  const { url, publishableKey } = getSupabaseConfig();
  const verified = createClient<Database>(url, publishableKey, { accessToken: async () => idToken, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await verified.rpc('exam_upload', { p_exam: id, p_action: 'complete', p_id: input.id, p_data: {} });
  if (error) return examReply(error);
  const done = data as { id?: unknown; name?: unknown; mime?: unknown } | null;
  return ok({ id: input.id, name: typeof done?.name === 'string' ? done.name : '', mime });
}

/** The student lists of one online exam (exam_queue: the run's staff). */
export const readExamQueue = (id: string, tab: QueueTab, page: number) => rpc('exam_queue', { p_exam: id, p_tab: tab, p_page: page });
/** Save the essay marks of one try (grade) or release one result. The reply is the result as the database now holds it. */
export function examWork(id: string, input: ExamWork): Promise<ExamResult> {
  if (input.action === 'grade') return rpc('exam_work', { p_exam: id, p_action: 'grade', p_revision: input.revision, p_data: { attemptId: input.attemptId, marks: input.marks, reason: input.reason } as unknown as Json });
  return rpc('exam_work', { p_exam: id, p_action: 'release', p_revision: input.revision, p_data: { resultId: input.resultId } });
}
export const releaseManyResults = (id: string, input: ExamReleaseMany) => rpc('exam_release_many', { p_exam: id, p_items: input.items as unknown as Json });
/** The mark sheet of a paper exam (exam_paper_sheet): every student, one Group, or 'none' (in no Group). */
export const readPaperSheet = (id: string, group: string | null, page: number) => rpc('exam_paper_sheet', { p_exam: id, p_group: group, p_page: page });
export const savePaperMarks = (id: string, input: ExamPaperMarks) => rpc('exam_paper_mark', { p_exam: id, p_items: input.items as unknown as Json });

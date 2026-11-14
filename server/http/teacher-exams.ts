import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z, type ZodTypeAny } from 'zod';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import {
  examLifecycle, examUpload, examWork, readExam, readExamPortal, readExamQueue, readPaperSheet, releaseManyResults, saveExam, savePaperMarks, setExamWindow, type ExamResult,
} from '@/server/services/teacher-exams';
import { isFirebaseStaging } from '@/shared/auth-config';
import { examLifecycle as lifecycleBody, examPaperMarks, examReleaseMany, examSave, examUpload as uploadBody, examWindow, examWork as workBody, portalQuery, queueQuery, sheetQuery } from '@/shared/contracts/teacher-exams';

type Context = { params: Promise<{ examId: string }> };
type TryContext = { params: Promise<{ examId: string; attemptId: string }> };
export const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const id = z.string().uuid();
/** 100 questions with long texts stay inside this; the others are small. A grade: 100 marks with a note each. Marks and releases: 500 items. */
export const EXAM_LIMITS = { save: 600000, small: 4096, work: 400000, many: 64000, marks: 2200000 } as const;

/** A read is same-origin: a browser says so in Sec-Fetch-Site, and an Origin, when one is sent, must be ours. */
export function sameOriginRead(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  return !origin || validFirebaseOrigin(request);
}
export async function signedIn() {
  const viewer = await getApplicationViewer();
  return viewer && viewer.backend === 'firebase' ? viewer : null;
}
/** The body, read up to `limit` bytes and parsed with a strict schema. A reply when it fails. */
export async function readBody<S extends ZodTypeAny>(request: NextRequest, schema: S, limit: number): Promise<{ data: z.infer<S> } | { failure: NextResponse }> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return { failure: reply({ kind: 'invalid' }, 415) };
  const reader = request.body?.getReader();
  if (!reader) return { failure: reply({ kind: 'invalid' }, 400) };
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return { failure: reply({ kind: 'too_large' }, 413) }; }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { failure: reply({ kind: 'invalid' }, 400) }; }
  const parsed = schema.safeParse(body);
  return parsed.success ? { data: parsed.data } : { failure: reply({ kind: 'invalid' }, 400) };
}
const send = (result: ExamResult) => reply(result.body, result.status);
/** Query parameters, each once: a repeated one is refused, never silently reduced to its last value. */
export function query<S extends ZodTypeAny>(request: NextRequest, schema: S): z.infer<S> | null {
  const keys = Array.from(request.nextUrl.searchParams.keys());
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  return parsed.success && keys.length === new Set(keys).size ? parsed.data : null;
}
async function examOf(context: Context | TryContext, allowNew = false): Promise<string | null | false> {
  const raw = (await context.params).examId;
  if (allowNew && raw === 'new') return null;
  const parsed = id.safeParse(raw);
  return parsed.success ? parsed.data : false;
}

/** A read: staging, same origin, then its parameters (a bad one is 400 before anyone is asked who they are), then sign-in. */
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
async function write(request: NextRequest, context: Context, allowNew: boolean, run: (userId: string, examId: string | null) => Promise<NextResponse>) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!validFirebaseOrigin(request)) return reply({ kind: 'denied' }, 403);
  const exam = await examOf(context, allowNew);
  if (exam === false) return reply({ kind: 'invalid' }, 400);
  try {
    const viewer = await signedIn();
    if (!viewer) return reply({ kind: 'signin' }, 401);
    return await run(viewer.id, exam);
  } catch { return reply({ kind: 'failed' }, 503); }
}

/** GET /api/teacher/exams?course=&tab=&page= : the Exams page (exam_portal). */
export async function examPortalGET(request: NextRequest) {
  return read(request, async () => query(request, portalQuery), async q => send(await readExamPortal(q.course ?? null, q.tab, q.page)));
}

/** GET /api/teacher/exams/<id> : one exam for the wizard (exam_get, staff only). */
export async function examGET(request: NextRequest, context: Context) {
  return read(request, async () => { const exam = await examOf(context); return exam && request.nextUrl.searchParams.size === 0 ? exam : null; }, async exam => send(await readExam(exam)));
}

/** POST /api/teacher/exams/<id|new>/save : a new exam names its run and kind; an existing one sends the revision it read. */
export function examSavePOST(request: NextRequest, context: Context) {
  return write(request, context, true, async (userId, examId) => {
    const body = await readBody(request, examSave, EXAM_LIMITS.save);
    if ('failure' in body) return body.failure;
    if (examId === null ? body.data.revision !== null || !body.data.offeringId || !body.data.definition.kind : body.data.revision === null) return reply({ kind: 'invalid' }, 400);
    return send(await saveExam(userId, examId, body.data));
  });
}

/** POST /api/teacher/exams/<id>/lifecycle : publish, unpublish, archive, clone, reschedule. */
export function examLifecyclePOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (_userId, examId) => {
    const body = await readBody(request, lifecycleBody, EXAM_LIMITS.small);
    if ('failure' in body) return body.failure;
    return send(await examLifecycle(examId as string, body.data));
  });
}

/** POST /api/teacher/exams/<id>/window : one Group's window (its session, another of its sessions, or a time). */
export function examWindowPOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (_userId, examId) => {
    const body = await readBody(request, examWindow, EXAM_LIMITS.small);
    if ('failure' in body) return body.failure;
    return send(await setExamWindow(examId as string, body.data));
  });
}

/** POST /api/teacher/exams/<id>/upload : a picture's place (intent), the server's byte check (complete), or a signed link (get). */
export function examUploadPOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (_userId, examId) => {
    const body = await readBody(request, uploadBody, EXAM_LIMITS.small);
    if ('failure' in body) return body.failure;
    return send(await examUpload(examId as string, body.data));
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Correcting and marks. The database decides who may read work, correct and release (the run's staff; the 'correct' and 'release' rights).
// ---------------------------------------------------------------------------------------------------------------------------------
/** GET /api/teacher/exams/<id>/queue?tab=&page= : the student lists (exam_queue). */
export async function examQueueGET(request: NextRequest, context: Context) {
  return read(request, async () => { const exam = await examOf(context), q = query(request, queueQuery); return exam && q ? { exam, q } : null; }, async ({ exam, q }) => send(await readExamQueue(exam, q.tab, q.page)));
}

/** GET /api/teacher/exams/<id>/tries/<attemptId> : the exam and that one try (exam_get with the try, staff only). */
export async function examTryGET(request: NextRequest, context: TryContext) {
  return read(request, async () => {
    const exam = await examOf(context), attempt = id.safeParse((await context.params).attemptId);
    return exam && attempt.success && request.nextUrl.searchParams.size === 0 ? { exam, attempt: attempt.data } : null;
  }, async ({ exam, attempt }) => send(await readExam(exam, attempt)));
}

/** POST /api/teacher/exams/<id>/work : save the essay marks of a try (grade) or release one result. */
export function examWorkPOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (_userId, examId) => {
    const body = await readBody(request, workBody, EXAM_LIMITS.work);
    if ('failure' in body) return body.failure;
    return send(await examWork(examId as string, body.data));
  });
}

/** POST /api/teacher/exams/<id>/release-many : "Release N grades" (online) or "Release marks" (paper), all or nothing. */
export function examReleaseManyPOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (_userId, examId) => {
    const body = await readBody(request, examReleaseMany, EXAM_LIMITS.many);
    if ('failure' in body) return body.failure;
    return send(await releaseManyResults(examId as string, body.data));
  });
}

/** GET /api/teacher/exams/<id>/sheet?group=&page= : the mark sheet of a paper exam (exam_paper_sheet). */
export async function examSheetGET(request: NextRequest, context: Context) {
  return read(request, async () => { const exam = await examOf(context), q = query(request, sheetQuery); return exam && q ? { exam, q } : null; }, async ({ exam, q }) => send(await readPaperSheet(exam, q.group ?? null, q.page)));
}

/** POST /api/teacher/exams/<id>/marks : paper marks and Absent, as typed (exam_paper_mark, all or nothing). */
export function examMarksPOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (_userId, examId) => {
    const body = await readBody(request, examPaperMarks, EXAM_LIMITS.marks);
    if ('failure' in body) return body.failure;
    return send(await savePaperMarks(examId as string, body.data));
  });
}

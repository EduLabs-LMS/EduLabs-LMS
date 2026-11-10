import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z, type ZodTypeAny } from 'zod';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { deleteHomeworkImages, homeworkLifecycle, readHomework, readPortal, saveHomework, type HomeworkResult } from '@/server/services/teacher-homework';
import { isFirebaseStaging } from '@/shared/auth-config';
import { homeworkDeleteImages, homeworkLifecycle as lifecycleBody, homeworkSave, portalQuery } from '@/shared/contracts/teacher-homework';

type Context = { params: Promise<{ homeworkId: string }> };
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const id = z.string().uuid();
/** A homework of 100 questions with long texts stays well inside this; save_homework refuses a definition over 500 000 bytes. */
const SAVE_LIMIT = 600000, SMALL_LIMIT = 4096;

/** A read is same-origin: a browser says so in Sec-Fetch-Site, and an Origin, when one is sent, must be ours. */
function sameOriginRead(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  return !origin || validFirebaseOrigin(request);
}
async function signedIn() {
  const viewer = await getApplicationViewer();
  return viewer && viewer.backend === 'firebase' ? viewer : null;
}
/** The body, read up to `limit` bytes and parsed with a strict schema. A reply when it fails. */
async function readBody<S extends ZodTypeAny>(request: NextRequest, schema: S, limit: number): Promise<{ data: z.infer<S> } | { failure: NextResponse }> {
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
const send = (result: HomeworkResult) => reply(result.body, result.status);

/** GET /api/teacher/homework?course=&tab=&page= : the Homework page (homework_portal). */
export async function homeworkPortalGET(request: NextRequest) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!sameOriginRead(request)) return reply({ kind: 'denied' }, 403);
  // Each parameter once: a repeated one is refused, never silently reduced to its last value.
  const keys = Array.from(request.nextUrl.searchParams.keys());
  const query = portalQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success || keys.length !== new Set(keys).size) return reply({ kind: 'invalid' }, 400);
  try {
    if (!await signedIn()) return reply({ kind: 'signin' }, 401);
    return send(await readPortal(query.data.course ?? null, query.data.tab, query.data.page));
  } catch { return reply({ kind: 'failed' }, 503); }
}

/** GET /api/teacher/homework/<id> : one homework for the wizard (get_homework, staff only). */
export async function homeworkGET(request: NextRequest, context: Context) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!sameOriginRead(request)) return reply({ kind: 'denied' }, 403);
  const homework = id.safeParse((await context.params).homeworkId);
  if (!homework.success) return reply({ kind: 'invalid' }, 400);
  try {
    if (!await signedIn()) return reply({ kind: 'signin' }, 401);
    return send(await readHomework(homework.data));
  } catch { return reply({ kind: 'failed' }, 503); }
}

async function write(request: NextRequest, context: Context, allowNew: boolean, run: (userId: string, homeworkId: string | null, request: NextRequest) => Promise<NextResponse>) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!validFirebaseOrigin(request)) return reply({ kind: 'denied' }, 403);
  const raw = (await context.params).homeworkId, homework = raw === 'new' && allowNew ? null : id.safeParse(raw);
  if (homework !== null && !homework.success) return reply({ kind: 'invalid' }, 400);
  try {
    const viewer = await signedIn();
    if (!viewer) return reply({ kind: 'signin' }, 401);
    return await run(viewer.id, homework ? homework.data : null, request);
  } catch { return reply({ kind: 'failed' }, 503); }
}

/** POST /api/teacher/homework/<id|new>/save */
export function homeworkSavePOST(request: NextRequest, context: Context) {
  return write(request, context, true, async (userId, homeworkId) => {
    const body = await readBody(request, homeworkSave, SAVE_LIMIT);
    if ('failure' in body) return body.failure;
    if (homeworkId === null && body.data.revision !== null) return reply({ kind: 'invalid' }, 400);
    return send(await saveHomework(userId, homeworkId, body.data));
  });
}

/** POST /api/teacher/homework/<id>/lifecycle : publish, unpublish, clone, reschedule. */
export function homeworkLifecyclePOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (userId, homeworkId) => {
    const body = await readBody(request, lifecycleBody, SMALL_LIMIT);
    if ('failure' in body) return body.failure;
    return send(await homeworkLifecycle(userId, homeworkId as string, body.data));
  });
}

/** POST /api/teacher/homework/<id>/delete-images */
export function homeworkDeleteImagesPOST(request: NextRequest, context: Context) {
  return write(request, context, false, async (_userId, homeworkId) => {
    const body = await readBody(request, homeworkDeleteImages, SMALL_LIMIT);
    if ('failure' in body) return body.failure;
    return send(await deleteHomeworkImages(homeworkId as string));
  });
}

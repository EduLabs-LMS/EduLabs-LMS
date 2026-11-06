import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { applyContentEdit, readCourseStructure } from '@/server/services/course-content';
import { isFirebaseStaging } from '@/shared/auth-config';
import { contentEdit } from '@/shared/contracts/course-content';

type Context = { params: Promise<{ courseId: string }> };
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const courseId = z.string().uuid();
/** 500 rows with their versions fit well inside this. */
const LIMIT = 80000;

export async function courseContentGET(_request: NextRequest, context: Context) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  const id = courseId.safeParse((await context.params).courseId);
  if (!id.success) return reply({ kind: 'invalid' }, 400);
  try {
    const viewer = await getApplicationViewer();
    if (!viewer || viewer.backend !== 'firebase') return reply({ kind: 'signin' }, 401);
    const result = await readCourseStructure(id.data);
    return reply(result.body, result.status);
  } catch { return reply({ kind: 'failed' }, 503); }
}

export async function courseContentPOST(request: NextRequest, context: Context) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!validFirebaseOrigin(request)) return reply({ kind: 'denied' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ kind: 'invalid' }, 415);
  const id = courseId.safeParse((await context.params).courseId);
  if (!id.success) return reply({ kind: 'invalid' }, 400);
  try {
    const viewer = await getApplicationViewer();
    if (!viewer || viewer.backend !== 'firebase') return reply({ kind: 'signin' }, 401);
    const reader = request.body?.getReader();
    if (!reader) return reply({ kind: 'invalid' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) { await reader.cancel(); return reply({ kind: 'too_large' }, 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply({ kind: 'invalid' }, 400); }
    const edit = contentEdit.safeParse(body);
    if (!edit.success) return reply({ kind: 'invalid' }, 400);
    const result = await applyContentEdit(viewer.id, id.data, edit.data);
    return reply(result.body, result.status);
  } catch { return reply({ kind: 'failed' }, 503); }
}

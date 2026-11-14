'use client';
import { getFirebaseAuth, restoreFirebaseAuth } from '@/frontend/lib/firebase';
import { getSupabaseConfig } from '@/shared/supabase-config';

const API = '/api/teacher/exams';
const STUDENT_API = '/api/exams';
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const EXAM_PICTURE_LIMIT = 5 * 1024 * 1024;

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const parsed = await response.json().catch(() => null) as T | null;
  if (!response.ok || parsed === null) throw Object.assign(new Error('Exam upload refused'), { status: response.status });
  return parsed;
}

/**
 * The upload flow, the homework way: a place from the database (intent), the bytes straight to Storage as the signed-in person (the lms-exams
 * policy lets them write only their own pending path), then the server's byte check (complete). Images only, 5 MB.
 */
async function transfer(api: string, examId: string, intentBody: Record<string, unknown>, file: File, onProgress: (percent: number) => void): Promise<{ id: string }> {
  if (!TYPES.includes(file.type) || file.size <= 0 || file.size > EXAM_PICTURE_LIMIT) throw new Error('Use a PNG, JPEG or WebP picture up to 5 MB.');
  const intent = await post<{ id: string; path: string }>(`${api}/${examId}/upload`, { action: 'intent', ...intentBody, mime: file.type, name: file.name.slice(0, 255) });
  if (!intent.path.startsWith(`${examId}/`) || intent.path.includes('..')) throw new Error('Unexpected upload path');
  await restoreFirebaseAuth();
  const token = await getFirebaseAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Sign in again before uploading.');
  const { url, publishableKey } = getSupabaseConfig();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${url}/storage/v1/object/lms-exams/${intent.path}`);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token); xhr.setRequestHeader('apikey', publishableKey); xhr.setRequestHeader('Content-Type', file.type); xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onerror = () => reject(new Error('Upload connection failed.'));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Storage refused this upload.'));
    xhr.send(file);
  });
  return post<{ id: string }>(`${api}/${examId}/upload`, { action: 'complete', id: intent.id });
}
/** A question or model answer picture (a teacher). */
export const uploadExamPicture = (examId: string, file: File, purpose: 'question' | 'model', onProgress: (percent: number) => void) => transfer(API, examId, { purpose }, file, onProgress);
/** A student's photo answer for the try they have open. */
export const uploadAnswerPhoto = (examId: string, attemptId: string, file: File, onProgress: (percent: number) => void) => transfer(STUDENT_API, examId, { attemptId }, file, onProgress);
/** A five-minute signed link of a ready picture (a question picture, a model answer picture or a student's photo answer). */
export const examPictureUrl = (examId: string, id: string) => post<{ url: string }>(`${API}/${examId}/upload`, { action: 'get', id }).then(r => r.url);
/** The same for a student: their own photo answer, or a question picture and model answer picture once review is open. */
export const studentPictureUrl = (examId: string, id: string) => post<{ url: string }>(`${STUDENT_API}/${examId}/upload`, { action: 'get', id }).then(r => r.url);

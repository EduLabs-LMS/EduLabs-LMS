'use client';
import { getFirebaseAuth, restoreFirebaseAuth } from '@/frontend/lib/firebase';
import { getSupabaseConfig } from '@/shared/supabase-config';

const API = '/api/teacher/exams';
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const EXAM_PICTURE_LIMIT = 5 * 1024 * 1024;

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const parsed = await response.json().catch(() => null) as T | null;
  if (!response.ok || parsed === null) throw Object.assign(new Error('Exam upload refused'), { status: response.status });
  return parsed;
}

/**
 * A question or model answer picture, the homework way: a place from the database (intent), the bytes straight to Storage as the signed-in
 * teacher (the lms-exams policy lets them write only their own pending path), then the server's byte check (complete). Images only, 5 MB.
 */
export async function uploadExamPicture(examId: string, file: File, purpose: 'question' | 'model', onProgress: (percent: number) => void): Promise<{ id: string }> {
  if (!TYPES.includes(file.type) || file.size <= 0 || file.size > EXAM_PICTURE_LIMIT) throw new Error('Use a PNG, JPEG or WebP picture up to 5 MB.');
  const intent = await post<{ id: string; path: string }>(`${API}/${examId}/upload`, { action: 'intent', purpose, mime: file.type, name: file.name.slice(0, 255) });
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
  return post<{ id: string }>(`${API}/${examId}/upload`, { action: 'complete', id: intent.id });
}
/** A five-minute signed link of a ready picture (a question picture, a model answer picture or a student's photo answer). */
export const examPictureUrl = (examId: string, id: string) => post<{ url: string }>(`${API}/${examId}/upload`, { action: 'get', id }).then(r => r.url);

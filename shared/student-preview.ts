/**
 * Student preview (teacher-side "View as student").
 *
 * Preview is look-only. It is a route area (/preview/**), never a stored mode, so it cannot be left
 * switched on by accident or forged by the client. It does not change the viewer's role, session or
 * tenant; every preview page re-checks teacher-side access on the server.
 */
export const PREVIEW_PATH = '/preview';
export const PREVIEW_BLOCKED_MESSAGE = 'Student preview is look-only. Nothing is saved.';

export const previewCourseHref = (courseId: string) => `${PREVIEW_PATH}/${courseId}`;
export const previewPartHref = (courseId: string, segmentId: string) => `${PREVIEW_PATH}/${courseId}/chapters/${segmentId}`;
export const isPreviewPath = (path: string) => path === PREVIEW_PATH || path.startsWith(`${PREVIEW_PATH}/`);

/**
 * Non-GET requests that may still run in preview. Each one records nothing about a student:
 * - lesson media: only signs a short-lived view URL for a video
 * - Firebase session refresh: keeps the teacher signed in
 * - personalization / communications: the teacher's own settings and notifications
 * Everything else (progress, homework, exams, attendance, enrollments, uploads, statistics, ...) is denied by default.
 */
const ALLOWED_NON_GET: RegExp[] = [
  /^\/api\/learning\/[0-9a-f-]{36}\/media$/,
  /^\/api\/auth\/firebase\/[A-Za-z0-9_-]+$/,
  /^\/api\/personalization$/,
  /^\/api\/communications$/,
];

export function previewAllowsRequest(method: string | undefined, url: string): boolean {
  const verb = (method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return true;
  let path: string;
  try {
    const parsed = new URL(url, 'https://preview.invalid');
    if (parsed.origin !== 'https://preview.invalid' && typeof location !== 'undefined' && parsed.origin !== location.origin) return false;
    path = parsed.pathname;
  } catch {
    return false;
  }
  return verb === 'POST' && ALLOWED_NON_GET.some(rule => rule.test(path));
}

/** Wraps fetch so a state-changing request never leaves the browser while previewing. */
export function guardFetch(realFetch: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (previewAllowsRequest(method, url)) return realFetch(input, init);
    return Promise.resolve(new Response(JSON.stringify({ error: PREVIEW_BLOCKED_MESSAGE }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
}

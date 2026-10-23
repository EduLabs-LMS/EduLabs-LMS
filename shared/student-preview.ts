/** Student preview is display-only: it never changes the real role, permissions, queries or endpoints. */
export const studentPreviewCookie = 'edulabs_student_preview';

type Membership = { status: string; role: string };

/** Same condition app/(dashboard)/(routes)/teacher/layout.tsx uses to let a user into teacher pages. */
export function isTeacherSide(memberships: Membership[], courseStaff: unknown[], offeringStaff: unknown[]) {
  const active = memberships.filter(m => m.status === 'active');
  return active.length > 0 && !!(courseStaff.length || offeringStaff.length || active.some(m => ['owner', 'admin', 'teacher', 'assistant'].includes(m.role)));
}

/** The cookie only counts for teacher-side users; for everyone else it is ignored. */
export function studentPreviewActive(teacherSide: boolean, cookieValue?: string | null) {
  return teacherSide && cookieValue === '1';
}

/** Routes that belong to teacher tools or to flows that record student data; preview sends the user back to Self-learning. */
export function previewHiddenRoute(pathname: string) {
  return /^\/(teacher|admin|exams|group|groups|sessions|sessions-groups)(\/|$)/.test(pathname);
}

const writeMethods = /^(POST|PUT|PATCH|DELETE)$/i;
const blockedWrites = [
  /^\/api\/learning\/[^/]+\/progress$/,
  /^\/api\/progress(\/|$)/,
  /^\/api\/homework\/[^/]+\/(work|upload-intent|finish-upload|cleanup)$/,
  /^\/api\/secure-exams\/[^/]+\/(start|answers|submit|decision|photo)$/,
  /^\/api\/exams(\/|$)/,
  /^\/api\/student-academics$/,
  /\/feedback(\/|$)/,
];
/** Defence in depth for student-data writes while previewing. Media link refreshes and other reads stay allowed. */
export function isBlockedPreviewWrite(method: string, url: string) {
  if (!writeMethods.test(method)) return false;
  let path = url;
  try { path = new URL(url, 'http://local.invalid').pathname; } catch { /* keep raw */ }
  return blockedWrites.some(rule => rule.test(path));
}

type GuardWindow = {
  fetch: (input: any, init?: any) => Promise<any>;
  XMLHttpRequest?: { prototype: { open: (...args: any[]) => void; send: (...args: any[]) => void } };
};
/** Installs the guard on fetch and XMLHttpRequest (axios). Returns an uninstall function. */
export function installPreviewWriteGuard(win: GuardWindow, onBlocked: () => void) {
  const originalFetch = win.fetch;
  win.fetch = (input: any, init?: any) => {
    const method = init?.method ?? (typeof input === 'object' && input && 'method' in input ? input.method : 'GET');
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (isBlockedPreviewWrite(method, url)) { onBlocked(); return Promise.reject(new Error('Not saved in preview')); }
    return originalFetch.call(win, input, init);
  };
  const proto = win.XMLHttpRequest?.prototype;
  const originalOpen = proto?.open, originalSend = proto?.send;
  if (proto && originalOpen && originalSend) {
    proto.open = function (this: any, method: string, url: string, ...rest: any[]) {
      this.__previewBlocked = isBlockedPreviewWrite(method, String(url));
      return originalOpen.call(this, method, url, ...rest);
    };
    proto.send = function (this: any, ...args: any[]) {
      if (this.__previewBlocked) { onBlocked(); this.abort?.(); return; }
      return originalSend.apply(this, args);
    };
  }
  return () => { win.fetch = originalFetch; if (proto && originalOpen && originalSend) { proto.open = originalOpen; proto.send = originalSend; } };
}

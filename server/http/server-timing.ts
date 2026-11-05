import 'server-only';
import { requestScope, serverTimingEnabled, serverTimingValue } from '@/server/request-scope';

/**
 * Adds a `Server-Timing` header (phase names, durations and call counts only: no ids, tokens, queries or user data)
 * when LMS_SERVER_TIMING=1, which is set on staging only. With it off the handler runs untouched.
 * Durations of phases that run in parallel overlap, so they do not add up to `total`.
 */
export function withServerTiming<R extends Request, A extends unknown[]>(handler: (request: R, ...rest: A) => Promise<Response> | Response) {
  return async (request: R, ...rest: A): Promise<Response> => {
    if (!serverTimingEnabled()) return handler(request, ...rest);
    const response = await handler(request, ...rest);
    const scope = await requestScope();
    if (scope) { try { response.headers.set('Server-Timing', serverTimingValue(scope)); } catch { /* immutable response: no header */ } }
    return response;
  };
}

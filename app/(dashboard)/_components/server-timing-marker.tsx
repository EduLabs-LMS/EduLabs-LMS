import { requestScope, serverTimingEnabled, serverTimingValue } from '@/server/request-scope';

/**
 * Pages cannot set response headers after they start rendering, so with LMS_SERVER_TIMING=1 (staging only) the same
 * `Server-Timing` text is put in the page as <script type="application/json" id="lms-server-timing">. Read it in the
 * browser console: JSON.parse(document.getElementById('lms-server-timing').textContent). Phase names, durations and call
 * counts only; no ids, tokens or user data. Render it LAST in a page, after the page's own data has been awaited.
 */
export async function ServerTimingMarker() {
  if (!serverTimingEnabled()) return null;
  const scope = await requestScope();
  if (!scope) return null;
  return <script type="application/json" id="lms-server-timing" dangerouslySetInnerHTML={{ __html: JSON.stringify(serverTimingValue(scope)).replace(/</g, '\u003c') }} />;
}

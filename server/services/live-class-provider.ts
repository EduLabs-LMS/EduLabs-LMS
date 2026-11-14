import 'server-only';
import { createHmac } from 'node:crypto';
import type { LiveClassJoin } from '@/shared/live-class';

/**
 * THE one place that knows the meeting server is Jitsi (self-hosted, docs/ai/ONLINE_CLASS_RUNBOOK.md). Everything else asks this file whether
 * live classes are configured and for the address/options of one class. Settings come from the web server's environment (runbook step 10:
 * LIVE_CLASS_PROVIDER=jitsi, LIVE_CLASS_URL, LIVE_CLASS_APP_ID, LIVE_CLASS_SECRET in /etc/edulabs/web.env). When any is missing or malformed, live
 * classes are OFF: the API answers 404 and every button stays hidden; "Own link" Sessions work as before.
 *
 * The token (HS256, the same secret as JWT_APP_SECRET in /etc/edulabs/jitsi.env): aud and iss are the app id, sub is the meeting host, room is
 * the Session's random room, nbf 30 seconds back (clock skew), exp at the end of the window and never more than 3 hours ahead. The person's display
 * name and whether they are a moderator (staff) are the only personal data; no email, no id.
 */
type Config = { origin: string; host: string; appId: string; secret: string };

export function liveClassConfig(env: Record<string, string | undefined> = process.env): Config | null {
  if (env.LIVE_CLASS_PROVIDER !== 'jitsi') return null;
  const raw = env.LIVE_CLASS_URL ?? '', appId = env.LIVE_CLASS_APP_ID ?? '', secret = env.LIVE_CLASS_SECRET ?? '';
  if (secret.length < 64 || !/^[A-Za-z0-9_-]{1,64}$/.test(appId)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || !['', '/'].includes(url.pathname)) return null;
  // A host name (the certificate is for meet.<domain>), never a bare IP address: the last label starts with a letter.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]([a-z0-9-]*[a-z0-9])?$/.test(url.hostname)) return null;
  return { origin: url.origin, host: url.hostname, appId, secret };
}
export const liveClassConfigured = (env: Record<string, string | undefined> = process.env) => liveClassConfig(env) !== null;

/** The buttons everyone has (TOOLBAR_BUTTONS in jitsi.env), and what staff add. Display only: the limits are in ONLINE_CLASS_AUDIT.md, "Known limits". */
export const STUDENT_BUTTONS = ['microphone', 'camera', 'chat', 'raisehand', 'participants-pane', 'tileview', 'fullscreen', 'settings', 'hangup'] as const;
export const STAFF_BUTTONS = [...STUDENT_BUTTONS, 'desktop', 'whiteboard', 'recording'] as const;
export const TOKEN_MAX_SECONDS = 3 * 3600;

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
export function classToken(c: Config, p: { room: string; name: string; moderator: boolean; closesAt: number; now: number }) {
  const now = Math.floor(p.now / 1000);
  const exp = Math.max(now + 60, Math.min(Math.floor(p.closesAt / 1000), now + TOKEN_MAX_SECONDS));
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ aud: c.appId, iss: c.appId, sub: c.host, room: p.room, nbf: now - 30, exp, context: { user: { name: p.name, moderator: p.moderator } } }));
  return `${head}.${body}.${createHmac('sha256', c.secret).update(`${head}.${body}`).digest('base64url')}`;
}

/**
 * The meeting for one person: the IFrame API script, the host, the options of `new JitsiMeetExternalAPI(host, options)` (the page adds parentNode
 * and lang), and the same meeting as a plain address for "Open in a new tab" (the fallback when the meeting does not work inside the page). That
 * address carries the same short-lived token as `?jwt=` (Jitsi's way of taking a token in a link) and the same settings in the `#config.` part.
 */
export function classJoin(c: Config, p: { room: string; name: string; moderator: boolean; title: string; closesAt: number; now: number }): LiveClassJoin {
  const jwt = classToken(c, p);
  const configOverwrite = {
    subject: p.title,
    prejoinConfig: { enabled: false },
    disableDeepLinking: true,
    // Students arrive muted with the camera off; the teacher arrives ready to talk.
    startWithAudioMuted: !p.moderator, startWithVideoMuted: !p.moderator,
    toolbarButtons: p.moderator ? [...STAFF_BUTTONS] : [...STUDENT_BUTTONS],
    disableInviteFunctions: true, hideConferenceSubject: false, readOnlyName: true,
  };
  const interfaceConfigOverwrite = { SHOW_JITSI_WATERMARK: false, SHOW_BRAND_WATERMARK: false, MOBILE_APP_PROMO: false };
  return {
    scriptUrl: `${c.origin}/external_api.js`,
    domain: c.host,
    options: { roomName: p.room, jwt, width: '100%', height: '100%', userInfo: { displayName: p.name }, configOverwrite, interfaceConfigOverwrite },
    openUrl: classAddress(c, p.room, jwt, configOverwrite, interfaceConfigOverwrite),
  };
}

/** `https://<host>/<room>?jwt=<token>#config.<key>=<JSON>&interfaceConfig.<key>=<JSON>`: each value JSON, then URI-encoded, as Jitsi reads it. */
function classAddress(c: Config, room: string, jwt: string, config: Record<string, unknown>, ui: Record<string, unknown>) {
  const flat: string[] = [];
  const add = (prefix: string, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) add(`${prefix}.${k}`, v);
    else flat.push(`${prefix}=${encodeURIComponent(JSON.stringify(value))}`);
  };
  add('config', config); add('interfaceConfig', ui);
  return `${c.origin}/${room}?jwt=${encodeURIComponent(jwt)}#${flat.join('&')}`;
}

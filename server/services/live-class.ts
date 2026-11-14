import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { classJoin, liveClassConfig } from '@/server/services/live-class-provider';
import { liveClassFailure, parseOpenRow, type LiveClassJoined, type LiveClassReply } from '@/shared/live-class';

export type LiveClassResult = { status: number; body: unknown };
type Rpc = (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

/**
 * Runs as the signed-in person (the RLS-bound server client; no service role). The database authorizes every call again
 * (private.live_class_open / private.live_class_joined resolve the caller with private.current_app_user_id()).
 */
async function rpc(name: 'live_class_open' | 'live_class_joined', args: Record<string, unknown>) {
  const client = await getSupabaseServerClient();
  return (client.rpc as unknown as Rpc)(name, args);
}

/** Open (and, for staff with start=true, start) one class. The token is signed only for state "open". */
export async function openLiveClass(sessionId: string, start: boolean, now = Date.now()): Promise<LiveClassResult> {
  const config = liveClassConfig();
  if (!config) return { status: 404, body: { kind: 'off' } };
  const { data, error } = await rpc('live_class_open', { p_session: sessionId, p_start: start });
  if (error) return liveClassFailure(error);
  const row = parseOpenRow(data);
  if (!row) return { status: 503, body: { kind: 'failed' } };
  const { room, moderator, displayName, ...reply } = row;
  const body: LiveClassReply = reply;
  if (row.state === 'open' && room && displayName) {
    body.join = classJoin(config, { room, name: displayName, moderator: Boolean(moderator), title: row.title, closesAt: Date.parse(row.closesAt), now });
  }
  return { status: 200, body };
}

/** Who opened the class (the Group's staff only): for Take attendance. */
export async function readLiveClassJoined(sessionId: string): Promise<LiveClassResult> {
  if (!liveClassConfig()) return { status: 404, body: { kind: 'off' } };
  const { data, error } = await rpc('live_class_joined', { p_session: sessionId });
  if (error) return liveClassFailure(error);
  const r = data as Partial<LiveClassJoined> | null;
  if (!r || typeof r.sessionId !== 'string' || typeof r.liveClass !== 'boolean' || !Array.isArray(r.joined) || !r.joined.every(x => typeof x === 'string')) return { status: 503, body: { kind: 'failed' } };
  const body: LiveClassJoined = { sessionId: r.sessionId, liveClass: r.liveClass, startedAt: typeof r.startedAt === 'string' ? r.startedAt : null, joined: r.joined };
  return { status: 200, body };
}

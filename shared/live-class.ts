import { z } from 'zod';

/**
 * The EduLabs class (docs/ai/DECISIONS.md, "Live classes"): the rules the screens, the API and the tests share. The database decides (migration
 * 20261119120000_live_class.sql, private.live_class_open); these only decide what to SHOW, and must say the same thing.
 */

/** A class can be opened from 15 minutes before its start to 30 minutes after its end. */
export const LIVE_CLASS_OPENS_BEFORE_MIN = 15;
export const LIVE_CLASS_CLOSES_AFTER_MIN = 30;

type Meeting = { mode: string; join_url?: string | null };
type Timed = { starts_at: string; ends_at: string; cancelled?: boolean };

/** An ONLINE Session with NO link is an EduLabs class; an online Session with a link is "Own link"; a centre Session is neither. */
export const isLiveClass = (s: Meeting) => s.mode === 'online' && !s.join_url;

export function liveClassWindow(s: Pick<Timed, 'starts_at' | 'ends_at'>) {
  return { opens: Date.parse(s.starts_at) - LIVE_CLASS_OPENS_BEFORE_MIN * 60000, closes: Date.parse(s.ends_at) + LIVE_CLASS_CLOSES_AFTER_MIN * 60000 };
}
/** Inside the window and not cancelled. */
export function liveClassOpenAt(s: Timed, now: number) {
  if (s.cancelled) return false;
  const w = liveClassWindow(s);
  return Number.isFinite(w.opens) && now >= w.opens && now < w.closes;
}
/** Not over yet (a student may open the page early: it waits and opens by itself). */
export function liveClassAhead(s: Timed, now: number) {
  return !s.cancelled && now < liveClassWindow(s).closes;
}

/** The class page. `start` makes staff start it on arrival (the page then drops it from the address). */
export const classHref = (sessionId: string, start = false) => `/class/${sessionId}${start ? '?start=1' : ''}`;

export const liveClassStates = ['early', 'waiting', 'ready', 'open', 'ended', 'cancelled'] as const;
export type LiveClassState = typeof liveClassStates[number];

/** What the page needs to put the meeting on screen. Built by the provider on the server; the browser never sees the secret. */
export type LiveClassJoin = { scriptUrl: string; domain: string; options: Record<string, unknown>; openUrl: string };
export type LiveClassReply = {
  state: LiveClassState; sessionId: string; groupId: string; title: string; groupName: string;
  startsAt: string; endsAt: string; opensAt: string; closesAt: string; serverNow: string; staff: boolean;
  startedNow?: boolean; join?: LiveClassJoin;
};
export type LiveClassJoined = { sessionId: string; liveClass: boolean; startedAt: string | null; joined: string[] };

export const liveClassOpenBody = z.object({ sessionId: z.string().uuid(), start: z.boolean() }).strict();
export const liveClassJoinedQuery = z.object({ sessionId: z.string().uuid() }).strict();

/** A database refusal, answered in the app's words, never with the database's message. */
export function liveClassFailure(error: { code?: string }): { status: number; body: { kind: string } } {
  const code = error.code ?? '';
  if (code === '42501' || code === 'PGRST116') return { status: 403, body: { kind: 'denied' } };
  if (code === '23514' || code === '22P02') return { status: 400, body: { kind: 'invalid' } };
  return { status: 503, body: { kind: 'failed' } };
}

/** The open/start reply from the database, checked before anything is signed. Null when it is not what the migration returns. */
export function parseOpenRow(row: unknown): (Omit<LiveClassReply, 'join'> & { room?: string; moderator?: boolean; displayName?: string }) | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const text = (k: string) => typeof r[k] === 'string' ? r[k] as string : null;
  const state = text('state');
  if (!state || !(liveClassStates as readonly string[]).includes(state)) return null;
  for (const k of ['sessionId', 'groupId', 'title', 'groupName', 'startsAt', 'endsAt', 'opensAt', 'closesAt', 'serverNow']) if (text(k) === null) return null;
  if (typeof r.staff !== 'boolean') return null;
  if (state === 'open' && (!/^[0-9a-f]{64}$/.test(text('room') ?? '') || typeof r.moderator !== 'boolean' || !text('displayName'))) return null;
  return {
    state: state as LiveClassState, sessionId: text('sessionId')!, groupId: text('groupId')!, title: text('title')!, groupName: text('groupName')!,
    startsAt: text('startsAt')!, endsAt: text('endsAt')!, opensAt: text('opensAt')!, closesAt: text('closesAt')!, serverNow: text('serverNow')!, staff: r.staff,
    ...(typeof r.startedNow === 'boolean' ? { startedNow: r.startedNow } : {}),
    ...(state === 'open' ? { room: text('room')!, moderator: r.moderator as boolean, displayName: text('displayName')! } : {}),
  };
}

import { validGroupMeetingUrl } from '@/shared/contracts/groups';

const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
/**
 * A fresh Jitsi room address for a group, made in the browser. Room names are random and hard to guess, but a Jitsi
 * link is not private: anyone who has it can join. The result is saved through the normal group edit and is checked
 * by the same HTTPS rule the server applies.
 */
export function makeJitsiRoom(random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  const room = Array.from(random(14), b => alphabet[b % alphabet.length]).join('');
  const url = `https://meet.jit.si/EduLabs-${room}`;
  if (!validGroupMeetingUrl(url)) throw new Error('Could not create a valid meeting link');
  return url;
}

export type GroupTab = 'overview' | 'members' | 'sessions' | 'settings' | 'attendance';
/** Staff manage a group in four tabs; students only see the overview and their own attendance. */
export function tabsFor(staff: boolean): GroupTab[] {
  return staff ? ['overview', 'members', 'sessions', 'settings'] : ['overview', 'attendance'];
}
/** The record view to load when a tab opens. */
export function defaultView(tab: GroupTab): string | null {
  return tab === 'members' ? 'members' : tab === 'settings' ? 'staff' : tab === 'attendance' ? 'history' : null;
}
/** Teachers and assistants have no attendance history of their own; only people who are students of a group do. */
export function showOwnHistory(isStaff: boolean) {
  return !isStaff;
}
/** "Mon 19:00 · 90 min" style label for one weekly meeting. */
export function weeklyLabel(s: { weekday: number; time: string; durationMinutes: number }, names: string[]) {
  return `${names[s.weekday] ?? ''} ${s.time} · ${s.durationMinutes} min`;
}

export type ModeFilter = 'online' | 'center' | 'both';
export type SortBy = 'next' | 'name';
/** The filter is general: one class type at a time, or both. Online is the default for teachers. */
export function filterByMode<T extends { mode: string }>(rows: T[], mode: ModeFilter): T[] {
  return mode === 'both' ? rows : rows.filter(r => r.mode === mode);
}
export type NextInfo = { start: number; end: number } | null | undefined;
/** Next session first (a live class counts as nearest); groups with no session, or not known yet, go last by name. */
export function sortGroups<T extends { id: string; name: string }>(rows: T[], nexts: Record<string, NextInfo>, by: SortBy, now: number): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const sorted = [...rows];
  if (by === 'name') return sorted.sort(byName);
  const upcoming = (id: string) => { const n = nexts[id]; return n && n.end > now ? n : null; };
  return sorted.sort((a, b) => { const x = upcoming(a.id), y = upcoming(b.id); if (x && y) return x.start - y.start || byName(a, b); if (x) return -1; if (y) return 1; return byName(a, b); });
}
/** Whole days, hours and minutes left (never negative). */
export function countdownParts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 60000));
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}
/** "2d 4h", "3h 20m" or "12m"; the unit letters come from the language files. */
export function countdownText(ms: number, units: { d: string; h: string; m: string }) {
  const { d, h, m } = countdownParts(ms);
  if (d > 0) return `${d}${units.d} ${h}${units.h}`;
  if (h > 0) return `${h}${units.h} ${m}${units.m}`;
  return `${Math.max(m, 1)}${units.m}`;
}

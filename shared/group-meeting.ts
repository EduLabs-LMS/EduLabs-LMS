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

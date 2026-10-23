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

export type GroupTab = 'overview' | 'members' | 'sessions' | 'more';
export const groupTabs: GroupTab[] = ['overview', 'members', 'sessions', 'more'];
/** Which record views belong to which tab. Students only ever see their own history. */
export function recordViews(staff: boolean, tab: GroupTab): string[] {
  if (!staff) return ['history'];
  if (tab === 'members') return ['members', 'eligible'];
  if (tab === 'more') return ['staff', 'history', 'audit'];
  return ['members', 'eligible', 'staff', 'history', 'audit'];
}
/** The view to load when a tab opens (staff only). */
export function defaultView(tab: GroupTab): string | null {
  return tab === 'members' ? 'members' : tab === 'more' ? 'history' : null;
}

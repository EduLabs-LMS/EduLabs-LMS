/** Display-only helpers for the Users & Study Groups screen. Nothing here changes who can see or do what. */
export type UsersTab = 'all' | 'students' | 'waitlist' | 'groups';

/**
 * The waitlist is optional and there is no on/off flag on the front end, so it is shown only while someone is
 * waiting (the existing pending count), or while the user is looking at past access requests on purpose.
 */
export function waitlistVisible(pendingCount: number | null, lookingAtRequests: boolean) {
  return (pendingCount ?? 0) > 0 || lookingAtRequests;
}

export function visibleTabs(waitlist: boolean): UsersTab[] {
  return waitlist ? ['all', 'students', 'waitlist', 'groups'] : ['all', 'students', 'groups'];
}

export type StatKey = 'total' | 'waitlist' | 'groups' | 'homework';
/** Stat cards in target order; the waitlist card disappears with the waitlist so the row re-flows. */
export function visibleStats(waitlist: boolean): StatKey[] {
  return waitlist ? ['total', 'waitlist', 'groups', 'homework'] : ['total', 'groups', 'homework'];
}

/** The tab to show when the waitlist disappears underneath the user (for example after approving the last request). */
export function safeTab(tab: UsersTab, waitlist: boolean): UsersTab {
  return tab === 'waitlist' && !waitlist ? 'all' : tab;
}

export function initialOf(name: string | null | undefined) {
  const trimmed = (name ?? '').trim();
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : '?';
}

export type StatusTone = 'good' | 'warn' | 'neutral';
export function statusTone(status: string): StatusTone {
  return status === 'active' || status === 'approved' ? 'good' : status === 'pending' || status === 'suspended' || status === 'invited' ? 'warn' : 'neutral';
}

/** Display-only helpers for the Support screens. Nothing here changes who can see or answer a ticket. */
export type WaitState = 'needs_reply' | 'waiting' | 'replied' | 'resolved';

/**
 * Who is the ticket waiting on? The existing data already says so: a requester message (or a new ticket) sets
 * response_due_at, a staff reply clears it, and Resolved clears it as well.
 */
export function waitState(ticket: { status: string; response_due_at: string | null }, viewerIsStaffForTicket: boolean): WaitState {
  if (ticket.status === 'RESOLVED') return 'resolved';
  if (!ticket.response_due_at) return 'replied';
  return viewerIsStaffForTicket ? 'needs_reply' : 'waiting';
}

/** Which subtitle fits this person: tickets sent to them as support staff, their own, or both. */
export function subtitleKind(rows: Array<{ staff?: boolean }>): 'requester' | 'staff' | 'both' {
  const staff = rows.some(r => r.staff), own = rows.some(r => !r.staff);
  return staff && own ? 'both' : staff ? 'staff' : 'requester';
}

/** The requester's name, taken from their earliest non-staff message on the page (null when not on this page). */
export function requesterName(messages: Array<{ staff: boolean; sender_name: string; created_at: string }>): string | null {
  const own = messages.filter(m => !m.staff).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return own[0]?.sender_name ?? null;
}

type DraftStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
export const draftKey = (userId: string, scope: string) => `edulabs:support-draft:${userId}:${scope}`;
/** Drafts live only in this browser. Storage can be blocked or full, so every call is allowed to fail silently. */
export function readDraft(storage: DraftStorage | null | undefined, key: string): string {
  try { return storage?.getItem(key) ?? ''; } catch { return ''; }
}
export function writeDraft(storage: DraftStorage | null | undefined, key: string, value: string) {
  try { if (value.trim()) storage?.setItem(key, value); else storage?.removeItem(key); } catch { /* draft is best effort */ }
}

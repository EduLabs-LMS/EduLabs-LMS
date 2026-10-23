/** Display roles shown to people. These are labels only; permissions come from the existing guards and database rules. */
export type ViewerRole = 'admin' | 'teacher' | 'assistant' | 'student';
type Membership = { status: string; role: string };

/**
 * The highest role someone holds, read from what the page already receives (organization memberships and course or group staff).
 * Admin > Teacher > Assistant > Student. An organization owner is the teacher who owns that LMS.
 * The platform owners' special support access is private to the database, so it cannot be told apart here.
 */
export function viewerRole(memberships: Membership[], courseStaff: { role: string }[], offeringStaff: { role: string }[]): ViewerRole {
  const org = memberships.filter(m => m.status === 'active').map(m => m.role);
  if (org.includes('admin')) return 'admin';
  if (org.includes('owner') || org.includes('teacher') || courseStaff.some(s => ['owner', 'instructor', 'editor'].includes(s.role)) || offeringStaff.some(s => s.role === 'instructor')) return 'teacher';
  if (org.includes('assistant') || courseStaff.some(s => s.role === 'assistant') || offeringStaff.some(s => s.role === 'teaching_assistant')) return 'assistant';
  return 'student';
}
/** Chip colours per role: red for Admin, amber for Teacher, violet for Assistant, green for Student. */
export const roleChipClass: Record<ViewerRole, string> = {
  admin: 'border-red-800 bg-red-50 text-red-900',
  teacher: 'border-amber-800 bg-amber-50 text-amber-900',
  assistant: 'border-violet-800 bg-violet-50 text-violet-900',
  student: 'border-green-800 bg-green-50 text-green-900',
};
export function legacyRole(value: string | null | undefined): ViewerRole {
  const v = (value ?? '').toLowerCase();
  return v === 'admin' || v === 'teacher' || v === 'assistant' ? v : 'student';
}

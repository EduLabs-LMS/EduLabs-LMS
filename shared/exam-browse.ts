/** Search, filter and sort for the exams list. Display only: it never changes what an exam shows or allows. */
export type ExamGroup = 'all' | 'active' | 'upcoming' | 'finished';
export type ExamSort = 'soonest' | 'name';
type Item = { title: string; offeringName: string; courseTitle: string | null; state: string; opensAt: string | null; closesAt: string | null; kind: string };

export function examGroup(state: string): Exclude<ExamGroup, 'all'> {
  if (state === 'NOT_STARTED' || state === 'IN_PROGRESS') return 'active';
  if (state === 'NOT_OPEN_YET') return 'upcoming';
  return 'finished';
}
export function filterExams<T extends Item>(items: T[], query: string, group: ExamGroup, kind = ''): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(e => (group === 'all' || examGroup(e.state) === group) && (!kind || e.kind === kind) && (!q || `${e.title} ${e.offeringName} ${e.courseTitle ?? ''}`.toLowerCase().includes(q)));
}
/** "Soonest": things you can do now first, then upcoming by opening time, then finished by name. */
export function sortExams<T extends Item>(items: T[], by: ExamSort): T[] {
  const byName = (a: T, b: T) => a.title.localeCompare(b.title);
  if (by === 'name') return [...items].sort(byName);
  const rank = (e: T) => ({ active: 0, upcoming: 1, finished: 2 })[examGroup(e.state)];
  return [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? (Date.parse(a.opensAt ?? '') || 0) - (Date.parse(b.opensAt ?? '') || 0) : rank(a) === 0 ? (Date.parse(a.closesAt ?? '') || Infinity) - (Date.parse(b.closesAt ?? '') || Infinity) : 0) || byName(a, b));
}

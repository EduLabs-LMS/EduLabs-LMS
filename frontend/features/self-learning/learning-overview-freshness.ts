// In-memory invalidation only: no identities, positions, progress or persistence.
// Each mounted overview acknowledges its own generation. Never consume another
// cached overview's invalidation just because a request has been dispatched.
let dirty = false;
let generation = 0;
let unknown = false;
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();
export const learningOverviewIsDirty = () => dirty;
export const learningOverviewServerSnapshot = () => false;
export const learningOverviewGeneration = () => generation;
export const learningOverviewServerGeneration = () => 0;
export function subscribeLearningOverview(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function markLearningOverviewDirty(proof?: { key: string; revision: number }) {
  dirty = true;
  generation++;
  if (!proof) unknown = true;
  else if (revisions.size < 32 || revisions.has(proof.key)) revisions.set(proof.key, Math.max(proof.revision, revisions.get(proof.key) ?? 0));
  else unknown = true; // bounded invalidation metadata, never a progress store
  listeners.forEach(listener => listener());
}
export function learningOverviewMatches(proofs: { key: string; revision: number }[]) {
  if (unknown || !revisions.size) return false;
  const observed = new Map(proofs.map(proof => [proof.key, proof.revision]));
  return Array.from(revisions).every(([key, revision]) => (observed.get(key) ?? -1) >= revision);
}
export function clearLearningOverviewDirty() {
  dirty = false;
  unknown = false;
  revisions.clear();
  listeners.forEach(listener => listener());
}

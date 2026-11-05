/**
 * An app action that leaves the page without being a link (signing out from the profile menu). While an attendance save is running, the leave guard
 * registers itself here and asks first, exactly as it does for a link. With no guard registered the action simply runs.
 */
type Guard = (action: () => void) => void;
let guard: Guard | null = null;

/** Returns the function that removes this guard. */
export function setActionGuard(next: Guard) {
  guard = next;
  return () => { if (guard === next) guard = null; };
}

export function requestGuardedAction(action: () => void) {
  if (guard) guard(action); else action();
}

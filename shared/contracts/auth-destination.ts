/** Exact internal destinations that may survive Firebase sign-in/sign-up. */
export function safeFirebaseAuthDestination(value: string | null): string {
  const path = value ?? '';
  return path === '/access'
    || /^\/join\/[A-Za-z0-9_-]{43}$/.test(path)
    || /^\/teacher-invitation\/[A-Za-z0-9_-]{43}$/.test(path)
    ? path : '/home';
}

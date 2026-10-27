import { invitationTokenPattern } from '@/shared/contracts/platform-provisioning';

/** Public page that an invited teacher opens. The secret travels in the URL fragment, which browsers never send to servers or in Referer. */
export const invitationPagePath = '/teacher-invitation';

/** `origin` must already be the trusted, configured application origin. */
export function buildInvitationLink(origin: string, secret: string) {
 if (!invitationTokenPattern.test(secret)) throw new Error('Invalid invitation secret');
 return `${origin}${invitationPagePath}#${secret}`;
}

/** Reads `#<secret>` from a location hash; anything else is not an invitation. */
export function invitationFromHash(hash: string): string | null {
 const value = hash.startsWith('#') ? hash.slice(1) : hash;
 return invitationTokenPattern.test(value) ? value : null;
}

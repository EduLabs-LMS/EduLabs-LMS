/**
 * The temporary Classic / New look switch (owner decision, DECISIONS.md). It changes only the visual layer of the teacher app and is deleted, together
 * with the losing look, once the owner and co-founder have decided. The value is a plain preference: it decides nothing about access and holds no user data.
 */
export const designCookieKey = 'edulabs_design';
export const designs = ['classic', 'new'] as const;
export type Design = typeof designs[number];
export const defaultDesign: Design = 'classic';
export const isDesign = (value: unknown): value is Design => value === 'classic' || value === 'new';
/** The value put on <html data-design>. Anything else in the cookie (old, edited, garbage) is the default and never reaches the page. */
export const designFromCookie = (value: unknown): Design => (isDesign(value) ? value : defaultDesign);
export const designCookie = (design: Design, secure: boolean) => `${designCookieKey}=${design}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;

/** How many avatar tints the tokens define (--d-avatar-1 .. --d-avatar-6). */
export const AVATAR_TINTS = 6;
/** FNV-1a: small, stable across devices and sessions. Only picks a colour; nothing is stored. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}
/** 1 .. AVATAR_TINTS, the same for the same id everywhere. */
export const avatarTint = (id: string) => (stableHash(id) % AVATAR_TINTS) + 1;
/** Up to two letters from the name, whole characters only (Arabic and emoji-safe). An empty name has no initials. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = (word: string) => Array.from(word)[0] ?? '';
  return (words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0])).toLocaleUpperCase();
}

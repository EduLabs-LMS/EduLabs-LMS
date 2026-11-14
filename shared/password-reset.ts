import { z } from 'zod';

/** Pure rules for the password-reset flow, shared by the server route, the two pages and the tests. Nothing here logs or stores anything. */

/** The app's one password rule (sign-up and account security use the same): at least 12 characters, typed twice. */
export const passwordMinLength = 12;
/** Firebase's longest accepted password. */
export const passwordMaxLength = 4096;

export const resetLanguages = ['en', 'ar'] as const;
export type ResetLanguage = typeof resetLanguages[number];

/** An email as the flow takes it: trimmed and lower-case, one address, 254 characters at most. Not a deliverability check. */
export const normalizeResetEmail = (value: string) => value.trim().toLowerCase();
export const validResetEmail = (value: string) => value.length >= 3 && value.length <= 254 && /^[^\s@<>(),;:"\\\[\]]+@[^\s@<>(),;:"\\\[\]]+\.[^\s@<>(),;:"\\\[\]]{2,}$/.test(value);

/**
 * The request body of POST /api/auth/firebase/password-reset. Strict: an unknown key is refused. `language` is the language the person chose in
 * this browser; it is left out when they never chose one, and the email then carries both languages.
 */
export const passwordResetRequestBody = z.object({
 email: z.string().max(320).transform(normalizeResetEmail).refine(validResetEmail, 'Enter a valid email address.'),
 language: z.enum(resetLanguages).optional(),
}).strict();
export type PasswordResetRequestBody = z.infer<typeof passwordResetRequestBody>;

/** Firebase action codes are URL-safe tokens. A shape check only; Firebase decides whether a code is good. */
export const resetCodeShape = /^[A-Za-z0-9_-]{8,512}$/;
export const validResetCode = (value: unknown): value is string => typeof value === 'string' && resetCodeShape.test(value);

/** Takes the oobCode out of the link Firebase Admin generated. The rest of that link (its hosted page, apiKey, continueUrl) is dropped. */
export function resetCodeFromFirebaseLink(link: string): string | null {
 try {
  const url = new URL(link);
  if (url.protocol !== 'https:') return null;
  const code = url.searchParams.get('oobCode');
  return validResetCode(code) ? code : null;
 } catch { return null; }
}
/** EduLabs' own page. `origin` is the configured APP_ORIGIN, never a request header. */
export const buildResetLink = (origin: string, code: string) => {
 if (!validResetCode(code)) throw new Error('Invalid reset code');
 return `${origin.replace(/\/+$/, '')}/reset-password?oobCode=${encodeURIComponent(code)}`;
};
export const resetCodeFromSearch = (search: string): string | null => {
 const code = new URLSearchParams(search).get('oobCode');
 return validResetCode(code) ? code : null;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The password the person types
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type PasswordProblem = 'too_short' | 'too_long' | 'mismatch';
/** The first thing wrong with the pair, or null. The confirmation is only compared once it has text. */
export function passwordProblem(password: string, confirmation: string): PasswordProblem | null {
 if (password.length < passwordMinLength) return 'too_short';
 if (password.length > passwordMaxLength) return 'too_long';
 if (password !== confirmation) return 'mismatch';
 return null;
}

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;
/**
 * A hint, never a rule: the only rule is the length. 0 is under the minimum; above it, length and variety raise the level, and a password made of
 * a few repeated characters or one plain run (abcdefgh..., 12345678...) stays at 1.
 */
export function passwordStrength(password: string): StrengthLevel {
 if (password.length < passwordMinLength) return 0;
 const distinct = new Set(password).size;
 let run = 1, longest = 1;
 for (let i = 1; i < password.length; i++) {
  const step = password.charCodeAt(i) - password.charCodeAt(i - 1);
  run = Math.abs(step) === 1 || step === 0 ? run + 1 : 1;
  longest = Math.max(longest, run);
 }
 if (distinct < 5 || longest >= Math.ceil(password.length * 0.75)) return 1;
 const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(rx => rx.test(password)).length;
 let level = 2;
 if (password.length >= 16) level++;
 if (classes >= 3 || password.length >= 24) level++;
 return Math.min(4, level) as StrengthLevel;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// What the reset page can be
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type ResetStatus = 'checking' | 'ready' | 'saving' | 'done' | 'expired' | 'invalid' | 'disabled' | 'network';
/** A dead end: nothing can be typed. Each offers "Send a new link" (and "Try again" for a lost connection). */
export const resetDeadEnds: readonly ResetStatus[] = ['expired', 'invalid', 'disabled'];

/** Firebase's error codes (client SDK) as the page's states. An unknown code is treated as an invalid link, never as success. */
export function resetFailure(code: string | undefined): ResetStatus | 'weak' {
 switch (code) {
  case 'auth/expired-action-code': return 'expired';
  case 'auth/user-disabled': return 'disabled';
  case 'auth/network-request-failed': case 'auth/internal-error': case 'auth/too-many-requests': return 'network';
  case 'auth/weak-password': return 'weak';
  default: return 'invalid'; // auth/invalid-action-code (a used or damaged code), auth/user-not-found, anything else
 }
}

export type ResetEvent =
 | { type: 'checked'; email: string }
 | { type: 'check_failed'; code: string | undefined }
 | { type: 'submit' }
 | { type: 'saved' }
 | { type: 'save_failed'; code: string | undefined }
 | { type: 'retry' };
export type ResetState = { status: ResetStatus; email: string | null; notice: 'weak' | 'network' | null };
export const initialResetState = (hasCode: boolean): ResetState => ({ status: hasCode ? 'checking' : 'invalid', email: null, notice: null });
/** The page's whole behaviour as one function: the screen renders a state and nothing else. */
export function resetReducer(state: ResetState, event: ResetEvent): ResetState {
 switch (event.type) {
  case 'checked': return state.status === 'checking' ? { status: 'ready', email: event.email, notice: null } : state;
  case 'check_failed': { const failure = resetFailure(event.code); return state.status === 'checking' ? { status: failure === 'weak' ? 'invalid' : failure, email: null, notice: null } : state; }
  case 'submit': return state.status === 'ready' ? { ...state, status: 'saving', notice: null } : state;
  case 'saved': return state.status === 'saving' ? { ...state, status: 'done', notice: null } : state;
  case 'save_failed': {
   if (state.status !== 'saving') return state;
   const failure = resetFailure(event.code);
   // A weak password or a lost connection leaves the form open to try again; the other failures end the link.
   if (failure === 'weak' || failure === 'network') return { ...state, status: 'ready', notice: failure };
   return { status: failure, email: null, notice: null };
  }
  case 'retry': return state.status === 'network' ? { status: 'checking', email: null, notice: null } : state;
 }
}

import { createUserWithEmailAndPassword, updateProfile, type Auth } from 'firebase/auth';
import { requestBrandedVerification } from '@/frontend/lib/branded-auth-email';

/** Resume only an already authenticated Firebase identity; never link by email. */
export async function registerFirebaseAccount(auth: Auth, email: string, password: string, name: string) {
  const address = email.trim();
  const current = auth.currentUser;
  const user = current?.email?.toLowerCase() === address.toLowerCase()
    ? current : (await createUserWithEmailAndPassword(auth, address, password)).user;
  try { await updateProfile(user, { displayName: name.trim() }); }
  catch { return { user, retryAfterSeconds: 0, message: 'Your account is saved. Your name could not be updated. Retry while signed in; do not create another account.' }; }
  if (user.emailVerified) return { user, retryAfterSeconds: 0, message: 'Your account is already verified.' };
  try {
    await requestBrandedVerification(user);
    return { user, retryAfterSeconds: 60, message: 'Your account is saved. Check your email for a verification link. You can sign in later with the same account.' };
  } catch (failure) {
    const throttled = (failure as { code?: string }).code === 'auth/too-many-requests';
    return { user, retryAfterSeconds: throttled ? 60 : 0, message: throttled
      ? 'Your account is saved. Verification email is temporarily rate-limited. Wait before retrying, or sign in later with the same account and resend verification. Learning access remains locked.'
      : 'Your account is saved, but verification email could not be sent. Retry verification while signed in, or sign in later with the same account. Learning access remains locked.' };
  }
}

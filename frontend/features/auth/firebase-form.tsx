'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { Brand, Tree } from '@/frontend/design/tree';
import { PreferenceControls, useLocale } from '@/frontend/design/preferences';
import { Eye, EyeOff } from 'lucide-react';
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { useEffect } from 'react';
import { getFirebaseAuth, restoreFirebaseAuth } from '@/frontend/lib/firebase';
import { synchronizeFirebaseSession, useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';

function readableError(failure: unknown) {
  const code = (failure as { code?: string })?.code;
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'This email already has an account. Sign in or reset your password.',
    'auth/weak-password': 'Choose a stronger password with at least 12 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/unauthorized-domain': 'This website domain needs to be authorized in Firebase.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  };
  return (code && messages[code]) || (failure instanceof Error && !code ? failure.message : 'Unable to sign in. Please try again.');
}
export function FirebaseForm({ register = false }: { register?: boolean }) {
  const { user, loading, error, refresh } = useFirebaseAuth();
  const { t } = useLocale();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const redirecting = useRef(false);
  const goHome = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    window.location.replace('/home');
  }, []);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await restoreFirebaseAuth(); await operation(); }
    catch (failure) { setMessage(readableError(failure)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void restoreFirebaseAuth().then(() => getRedirectResult(getFirebaseAuth())).catch(failure => setMessage(readableError(failure))); }, []);
  useEffect(() => {
    if (user?.emailVerified && !loading && !error && !busy) goHome();
  }, [user, loading, error, busy, goHome]);
  const submit = () => run(async () => {
    const auth = getFirebaseAuth();
    const credential = register ? await createUserWithEmailAndPassword(auth, email.trim(), password) : await signInWithEmailAndPassword(auth, email.trim(), password);
    if (register) { await sendEmailVerification(credential.user); setMessage('Check your email for a verification link.'); }
    else { await synchronizeFirebaseSession(credential.user); goHome(); }
  });
  const google = () => run(async () => {
    const provider = new GoogleAuthProvider();
    try {
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      await synchronizeFirebaseSession(credential.user); goHome();
    } catch (failure) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes((failure as { code: string }).code)) {
        await signInWithRedirect(getFirebaseAuth(), provider);
      } else throw failure;
    }
  });
  return <div className="edu-auth">
    <header className="edu-auth-top"><Link href="/design-preview" aria-label="EduLabs"><Brand /></Link><PreferenceControls /></header>
    <section className="edu-auth-card">
      <aside className="edu-auth-side"><Tree variant="ink" /><div><h2>{t('Your class, one login away.')}</h2><p className="mt-6">{t('Every student signs in with their own email')}</p><p className="mt-3">{t('Pick up your lessons on any device')}</p></div><span>EduLabs</span></aside>
      <div className="edu-auth-main"><span className="edu-pill">EduLabs</span><h1 className="mt-4">{t(register ? 'Create your learning account' : 'Welcome back')}</h1><p className="edu-muted mt-2">{t('Sign in to continue')}</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>{t('Email')}<input disabled={busy || loading} required type="email" dir="ltr" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>{t('Password')}<span className="edu-password"><input disabled={busy || loading} required type={showPassword ? 'text' : 'password'} dir="ltr" minLength={register ? 12 : undefined} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /><button type="button" aria-pressed={showPassword} aria-label={t(showPassword ? 'Hide password' : 'Show password')} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
      {register && <p className="edu-muted text-sm">{t('Choose a stronger password with at least 12 characters.')}</p>}
      <button disabled={busy || loading} aria-busy={busy || loading} className="edu-btn edu-btn-green w-full">{t(busy ? 'Please wait…' : register ? 'Create account' : 'Sign in')}</button>
    </form>
    <button disabled={busy || loading} onClick={() => void google()} className="edu-btn mt-4 w-full">{t('Continue with Google')}</button>
    {!register && <button disabled={busy || !email} onClick={() => void run(async () => { await sendPasswordResetEmail(getFirebaseAuth(), email.trim()); setMessage('If an account exists, a password reset email has been sent.'); })} className="edu-link mt-4">{t('Forgot password?')}</button>}
    {user && !user.emailVerified && <div className="edu-notice"><p>{t('Check your email for a verification link.')}</p><div className="edu-auth-links">
      <button disabled={busy} className="edu-link" onClick={() => void run(async () => { await sendEmailVerification(user); setMessage('Verification email sent.'); })}>{t('Resend verification')}</button>
      <button disabled={busy} className="edu-link" onClick={() => void run(async () => { await refresh(); goHome(); })}>{t('I verified my email')}</button>
    </div></div>}
    {(message || error) && <p role="status" aria-live="polite" className="edu-notice">{t(message || error || '')}</p>}
    <p className="mt-6 text-sm"><Link className="edu-link" href={register ? '/sign-in' : '/sign-up'}>{t(register ? 'Already have an account? Sign in' : 'Create an account')}</Link></p>
    </div></section>
  </div>;
}

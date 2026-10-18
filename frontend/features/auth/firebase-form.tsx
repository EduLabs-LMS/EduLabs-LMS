'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, getRedirectResult,updateProfile } from 'firebase/auth';
import { useEffect } from 'react';
import { getFirebaseAuth, restoreFirebaseAuth } from '@/frontend/lib/firebase';
import { synchronizeFirebaseSession, useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';
import { safeStudentAuthDestination } from '@/shared/contracts/student-administration';

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
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [displayName,setDisplayName]=useState('');const [next,setNext]=useState('/home');
  useEffect(()=>setNext(safeStudentAuthDestination(new URLSearchParams(window.location.search).get('next'))),[]);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const redirecting = useRef(false);
  const goHome = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    window.location.replace(safeStudentAuthDestination(new URLSearchParams(window.location.search).get('next')));
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
    if(register&&!displayName.trim())throw Error('Enter your full name.');
    const auth = getFirebaseAuth();
    const credential = register ? await createUserWithEmailAndPassword(auth, email.trim(), password) : await signInWithEmailAndPassword(auth, email.trim(), password);
    if (register) { await updateProfile(credential.user,{displayName:displayName.trim()});await sendEmailVerification(credential.user); setMessage('Check your email for a verification link.'); }
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
  return <section className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-slate-900">
    <h1 className="text-2xl font-semibold">EduLabs</h1>
    <p className="mt-2 mb-6 text-slate-500">{register ? 'Create your learning account' : 'Sign in to continue'}</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4">
      {register&&<label className="block">Full name<input disabled={busy||loading} required maxLength={120} value={displayName} onChange={e=>setDisplayName(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>}
      <label className="block">Email<input disabled={busy || loading} required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
      <label className="block">Password<input disabled={busy || loading} required type="password" minLength={register ? 12 : undefined} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
      <button disabled={busy || loading} className="w-full rounded-lg bg-sky-600 p-3 text-white disabled:opacity-50">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
    </form>
    <button disabled={busy || loading} onClick={() => void google()} className="mt-4 w-full rounded-lg border p-3">Continue with Google</button>
    {!register && <button disabled={busy || !email} onClick={() => void run(async () => { await sendPasswordResetEmail(getFirebaseAuth(), email.trim()); setMessage('If an account exists, a password reset email has been sent.'); })} className="mt-4 text-sky-700">Forgot password?</button>}
    {user && !user.emailVerified && <div className="mt-4 flex gap-4">
      <button disabled={busy} onClick={() => void run(async () => { await sendEmailVerification(user); setMessage('Verification email sent.'); })}>Resend verification</button>
      <button disabled={busy} onClick={() => void run(async () => { await refresh(); goHome(); })}>I verified my email</button>
    </div>}
    {(message || error) && <p role="status" className="mt-4 text-sm">{message || error}</p>}
    <p className="mt-6 text-sm"><Link className="text-sky-700" href={(register?'/sign-in':'/sign-up')+(next==='/home'?'':'?next='+encodeURIComponent(next))}>{register ? 'Already have an account? Sign in' : 'Create an account'}</Link></p>
  </section>;
}

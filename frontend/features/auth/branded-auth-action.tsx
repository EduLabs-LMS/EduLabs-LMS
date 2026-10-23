'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import EduLabsMark from '@/frontend/components/edulabs-mark';
import { getFirebaseAuth } from '@/frontend/lib/firebase';

type Mode = 'verifyEmail' | 'resetPassword' | '';

export default function BrandedAuthAction() {
  const [mode, setMode] = useState<Mode>('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Remove the one-time code from the address bar/history as soon as it is read.
    const current = new URL(window.location.href);
    const action = current.searchParams.get('mode');
    const oobCode = current.searchParams.get('oobCode') ?? '';
    window.history.replaceState({}, document.title, '/auth/action');
    if ((action !== 'verifyEmail' && action !== 'resetPassword') || !oobCode || oobCode.length > 4096) {
      setMessage('This link is invalid or incomplete. Request a new email and try again.');
      setReady(true);
      return;
    }
    setMode(action);
    setCode(oobCode);
    void (async () => {
      try {
        const auth = getFirebaseAuth();
        const info = await checkActionCode(auth, oobCode);
        if (action === 'verifyEmail') {
          setEmail(info.data.email ?? '');
          setMessage('Confirm below to verify your email address.');
        } else {
          const address = await verifyPasswordResetCode(auth, oobCode);
          setEmail(address);
          setMessage('Choose a new password for your EduLabs account.');
        }
      } catch {
        setMessage('This link has expired, has already been used, or is invalid. Request a new email to continue.');
      } finally {
        setReady(true);
      }
    })();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !code || busy || success) return;
    setBusy(true);
    setMessage('');
    try {
      const auth = getFirebaseAuth();
      if (mode === 'verifyEmail') {
        await applyActionCode(auth, code);
        setSuccess(true);
        setMessage('Your email address is verified. You can now sign in to EduLabs.');
      } else if (mode === 'resetPassword') {
        if (password.length < 12) throw new Error('Choose a password with at least 12 characters.');
        if (password !== confirm) throw new Error('The passwords do not match.');
        await confirmPasswordReset(auth, code, password);
        setSuccess(true);
        setMessage('Your password has been updated. You can now sign in securely.');
      } else {
        throw new Error('This action link is invalid.');
      }
    } catch (failure) {
      const code = (failure as { code?: string }).code;
      const safe = failure instanceof Error && !code ? failure.message : '';
      setMessage(safe || (code === 'auth/weak-password'
        ? 'Choose a stronger password.'
        : 'This link is no longer valid. Request a new email and try again.'));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = ready && !!code && !success && !message.startsWith('This link is invalid or incomplete') &&
    !message.startsWith('This link has expired') && !!mode;

  return <main className="min-h-screen bg-[#e9eee5] px-4 py-12 text-[#142011]">
    <div className="mx-auto max-w-lg">
      <header className="mb-6 flex items-center gap-3">
        <EduLabsMark />
        <span className="text-2xl font-extrabold tracking-tight">EduLabs</span>
      </header>
      <section className="rounded-3xl border-2 border-black bg-[#f7f8f3] p-6 shadow-[5px_5px_0_#111] sm:p-9">
        <p className="mb-3 text-xs font-extrabold uppercase tracking-[.16em] text-[#276b39]">EDULABS ACCOUNT</p>
        <h1 className="mb-3 text-3xl font-extrabold tracking-tight">
          {!ready ? 'Checking your link…' : mode === 'verifyEmail' ? 'Verify your email' : mode === 'resetPassword' ? 'Reset your password' : 'Authentication link'}
        </h1>
        {email && <p className="mb-4 break-words text-sm text-slate-600">{email}</p>}
        {message && <p role="status" aria-live="polite" className="mb-5 rounded-xl border border-[#cbd8c4] bg-white p-4 text-sm leading-6">{message}</p>}
        {canSubmit && <form onSubmit={submit} className="space-y-4">
          {mode === 'resetPassword' && <>
            <label className="block text-sm font-semibold">New password
              <input autoComplete="new-password" type="password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-2 focus:ring-[#7ed957]" />
            </label>
            <label className="block text-sm font-semibold">Confirm new password
              <input autoComplete="new-password" type="password" minLength={12} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-2 w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-2 focus:ring-[#7ed957]" />
            </label>
          </>}
          <button type="submit" disabled={busy} className="w-full rounded-xl border-2 border-black bg-[#7ed957] p-3 font-bold shadow-[3px_3px_0_#111] disabled:opacity-60">
            {busy ? 'Please wait…' : mode === 'verifyEmail' ? 'Verify email address' : 'Update password'}
          </button>
        </form>}
        <div className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
          <Link href="/sign-in" className="underline underline-offset-4">Return to sign in</Link>
          {!success && mode === 'resetPassword' && <Link href="/sign-in" className="underline underline-offset-4">Request another reset link</Link>}
        </div>
      </section>
      <p className="mt-6 text-center text-xs text-slate-600">EduLabs will never ask you to share your password or one-time link.</p>
    </div>
  </main>;
}

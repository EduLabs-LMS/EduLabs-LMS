'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { languageStorageKey } from '@/shared/language';
import { normalizeResetEmail, validResetEmail } from '@/shared/password-reset';
import { ForgotPasswordView, type ForgotError } from './password-reset-views';

const endpoint = '/api/auth/firebase/password-reset';
const cooldownSeconds = 60;

/** The language the person chose in this browser, if they ever did. Never a guess: without it the email carries both languages. */
function chosenLanguage(): 'en' | 'ar' | undefined {
 try { const value = localStorage.getItem(languageStorageKey); return value === 'ar' || value === 'en' ? value : undefined; } catch { return undefined; }
}

/** "Forgot your password?": asks the server for a reset email. The page says the same thing whether or not an account exists, because the server does. */
export function ForgotPassword() {
 const [email, setEmail] = useState(''), [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form'), [error, setError] = useState<ForgotError>(null), [cooldown, setCooldown] = useState(0);
 const inFlight = useRef(false);
 useEffect(() => {
  if (cooldown <= 0) return;
  const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
  return () => clearTimeout(timer);
 }, [cooldown]);
 const send = useCallback(async (from: 'form' | 'sent') => {
  if (inFlight.current) return;
  const address = normalizeResetEmail(email);
  if (!validResetEmail(address)) { setError('bad_email'); return; }
  inFlight.current = true; setError(null);
  if (from === 'form') setPhase('sending');
  try {
   const language = chosenLanguage();
   const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(language ? { email: address, language } : { email: address }), credentials: 'same-origin', cache: 'no-store' });
   if (response.status === 202) { setPhase('sent'); setCooldown(cooldownSeconds); return; }
   setError(response.status === 429 ? 'wait' : response.status === 503 ? 'unavailable' : response.status === 400 ? 'bad_email' : 'failed');
   if (from === 'form') setPhase('form');
  } catch {
   setError('failed'); if (from === 'form') setPhase('form');
  } finally { inFlight.current = false; }
 }, [email]);
 return <ForgotPasswordView phase={phase} email={email} onEmail={(value) => { setEmail(value); if (error === 'bad_email') setError(null); }} error={error} cooldown={cooldown}
  onSubmit={() => void send('form')} onResend={() => void send('sent')} signInHref="/sign-in" />;
}

'use client';
import { useEffect, useReducer, useState } from 'react';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { getFirebaseAuth } from '@/frontend/lib/firebase';
import { initialResetState, passwordProblem, resetCodeFromSearch, resetReducer } from '@/shared/password-reset';
import { ResetPasswordView } from './password-reset-views';

const codeOf = (failure: unknown) => (failure as { code?: string } | null)?.code;

/**
 * The reset page EduLabs serves itself (/reset-password?oobCode=...). Firebase's own hosted page is never linked.
 * The code is checked when the page opens (and says which email it is for), the new password is typed twice, and the code is spent by confirmPasswordReset.
 * The code and the passwords stay in this component's memory: nothing is logged, stored or sent anywhere but to Firebase.
 */
export function ResetPassword() {
 const [state, dispatch] = useReducer(resetReducer, undefined, () => initialResetState(true));
 const [code, setCode] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
 const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [show, setShow] = useState(false), [showProblem, setShowProblem] = useState(false);

 useEffect(() => {
  let active = true;
  const found = resetCodeFromSearch(window.location.search);
  setCode(found);
  if (!found) { dispatch({ type: 'check_failed', code: 'auth/invalid-action-code' }); return; }
  verifyPasswordResetCode(getFirebaseAuth(), found).then(
   (email) => { if (active) dispatch({ type: 'checked', email }); },
   (failure) => { if (active) dispatch({ type: 'check_failed', code: codeOf(failure) }); },
  );
  return () => { active = false; };
 }, [attempt]);

 const problem = passwordProblem(password, confirm);
 const submit = () => {
  setShowProblem(true);
  if (problem || !code || state.status !== 'ready') return;
  dispatch({ type: 'submit' });
  confirmPasswordReset(getFirebaseAuth(), code, password).then(
   () => {
    setPassword(''); setConfirm(''); setShowProblem(false);
    // The code is spent: take it out of the address bar and the history entry.
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* the page still works */ }
    dispatch({ type: 'saved' });
   },
   (failure) => dispatch({ type: 'save_failed', code: codeOf(failure) }),
  );
 };
 return <ResetPasswordView state={state} password={password} confirm={confirm} show={show} onPassword={setPassword} onConfirm={setConfirm} onToggle={() => setShow((value) => !value)}
  problem={problem} showProblem={showProblem} onSubmit={submit}
  onRetry={() => { dispatch({ type: 'retry' }); setAttempt((value) => value + 1); }} forgotHref="/forgot-password" signInHref="/sign-in" />;
}

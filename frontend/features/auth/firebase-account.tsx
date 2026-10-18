'use client';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';
import { useState } from 'react';
import { useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';

export function FirebaseAccount() {
  const { openUserProfile }=useApplicationAuth();
  const { user, loading, logout } = useFirebaseAuth();
  const [error, setError] = useState('');
  return <div className="flex items-center gap-4 text-sm">
    <button onClick={openUserProfile} className="rounded-lg border-2 border-black px-3 py-2 font-semibold">{loading ? 'Restoring session…' : 'Your account'}</button>
    <button onClick={() => void logout().catch(() => { setError('Signed out locally. Server revocation could not be confirmed; retry sign-in and logout.'); })} className="rounded-lg border px-4 py-2">Sign out</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}

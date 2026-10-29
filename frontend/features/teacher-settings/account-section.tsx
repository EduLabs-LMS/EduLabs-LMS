'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';

const panel = 'rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6';
const button = 'inline-flex min-h-[44px] items-center gap-2 rounded-xl border-2 border-black bg-primary px-5 py-2.5 text-sm font-bold shadow-hard-sm disabled:opacity-50';

/**
 * My account: the same identity-bound account the student Settings page shows (same hook, same strings). Name and photo are edited in the existing
 * account editor that `openUserProfile` opens; nothing here writes anything itself. Student Settings (DashboardForm) is not changed.
 */
export function TeacherAccountSection() {
  const { ui } = useLanguage();
  const { user, openUserProfile, signOut, accountStatus } = useApplicationAuth();
  const [failedImage, setFailedImage] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function logout() {
    if (busy) return;
    setBusy(true); setError('');
    try { await signOut(); } catch { setError('Sign-out could not be confirmed. Retry, or sign in again if you were signed out locally.'); } finally { setBusy(false); }
  }
  return <div data-settings-account className="space-y-6">
    <section aria-labelledby="ts-account-h" className={panel}>
      <h2 id="ts-account-h" className="font-display text-2xl"><L id="settings.account_profile" /></h2>
      {accountStatus?.loading && !user ? <p role="status" className="mt-5"><L id="settings.loading_your_account" /></p>
        : !user ? <div className="mt-5"><p><L id="settings.your_account_could_not_be" /></p><Link className="mt-3 inline-flex min-h-[44px] items-center underline" href="/sign-in"><L id="settings.sign_in_again" /></Link></div>
        : <>
          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-black bg-primary/20">
              {user.imageUrl && failedImage !== user.imageUrl ? <Image alt={ui('Your profile photo')} unoptimized width={96} height={96} src={user.imageUrl} className="h-full w-full object-cover" onError={() => setFailedImage(user.imageUrl)} /> : <User aria-label={ui('No profile photo available')} className="h-10 w-10" />}
            </div>
            <dl className="min-w-0 space-y-3 text-sm">
              <div><dt className="text-slate-600"><L id="settings.display_name" /></dt><dd className="break-words text-lg font-bold"><bdi dir="auto">{user.fullName?.trim() || ui('Name not set')}</bdi></dd></div>
              <div><dt className="text-slate-600"><L id="settings.email_address" /></dt><dd className="break-all font-semibold"><bdi dir="ltr">{user.email || ui('Email not available')}</bdi></dd></div>
            </dl>
          </div>
          {accountStatus?.loading && <p role="status" className="mt-4 text-sm"><L id="settings.refreshing_your_profile" /></p>}
          <p className="mt-5 text-sm text-slate-600"><L id="settings.manage_your_name_photo_and" /></p>
          <button type="button" className={`${button} mt-4`} onClick={openUserProfile} disabled={busy}><L id="settings.manage_account" /></button>
        </>}
      {accountStatus?.error && <div role="alert" className="mt-4 text-sm text-red-800"><p><L id="settings.your_profile_details_could_not" /></p>{accountStatus.reload && <button type="button" className="mt-2 min-h-[44px] font-semibold underline" onClick={() => void accountStatus.reload?.()}><L id="settings.retry_profile" /></button>}<Link href="/sign-in" className="ms-3 inline-flex min-h-[44px] items-center underline"><L id="settings.sign_in_again" /></Link></div>}
    </section>
    {user && <section aria-labelledby="ts-session-h" className={panel}>
      <h2 id="ts-session-h" className="font-display text-2xl"><L id="settings.your_session" /></h2>
      <p className="mt-3 text-sm text-slate-600"><L id="settings.sign_out_of_edulabs_on" /></p>
      <button type="button" className={`${button.replace('bg-primary', 'bg-white')} mt-4`} onClick={() => void logout()} disabled={busy}><LogOut aria-hidden className="h-4 w-4" />{busy ? <L id="account.signingOut" /> : <L id="navigation.sign_out" />}</button>
      {error && <p role="alert" className="mt-3 text-sm text-red-800"><L text={error} /></p>}
    </section>}
  </div>;
}

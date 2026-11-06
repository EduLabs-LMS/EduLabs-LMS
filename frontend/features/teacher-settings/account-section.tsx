'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';
import { SpaceNames, type SpaceRow } from './space-names';

const panel = 'd-card d-card--pad d-stack';

/**
 * My account: the same identity-bound account the student Settings page shows (same hook, same strings). Name and photo are edited in the existing
 * account editor that `openUserProfile` opens; nothing here writes anything itself. Student Settings (DashboardForm) is not changed.
 */
export function TeacherAccountSection({ spaces = [] }: { spaces?: SpaceRow[] }) {
  const { ui } = useLanguage();
  const { user, openUserProfile, signOut, accountStatus } = useApplicationAuth();
  const [failedImage, setFailedImage] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function logout() {
    if (busy) return;
    setBusy(true); setError('');
    try { await signOut(); } catch { setError('Sign-out could not be confirmed. Retry, or sign in again if you were signed out locally.'); } finally { setBusy(false); }
  }
  return <div data-settings-account className="d-stack-lg">
    <section aria-labelledby="ts-account-h" className={panel}>
      <h2 id="ts-account-h" className="d-section"><L id="settings.account_profile" /></h2>
      {accountStatus?.loading && !user ? <p role="status" className="d-body"><L id="settings.loading_your_account" /></p>
        : !user ? <><p className="d-body"><L id="settings.your_account_could_not_be" /></p><Link className={buttonClass('secondary')} href="/sign-in"><L id="settings.sign_in_again" /></Link></>
        : <>
          <div className="d-account">
            <div className="d-account-photo">
              {user.imageUrl && failedImage !== user.imageUrl ? <Image alt={ui('Your profile photo')} unoptimized width={72} height={72} src={user.imageUrl} className="h-full w-full object-cover" onError={() => setFailedImage(user.imageUrl)} /> : <User aria-label={ui('No profile photo available')} className="h-8 w-8" />}
            </div>
            <dl className="d-dl">
              <div><dt><L id="settings.display_name" /></dt><dd className="d-wrap"><bdi dir="auto">{user.fullName?.trim() || ui('Name not set')}</bdi></dd></div>
              <div><dt><L id="settings.email_address" /></dt><dd className="d-wrap-all"><bdi dir="ltr">{user.email || ui('Email not available')}</bdi></dd></div>
            </dl>
          </div>
          {accountStatus?.loading && <p role="status" className="d-meta"><L id="settings.refreshing_your_profile" /></p>}
          <p className="d-meta"><L id="settings.manage_your_name_photo_and" /></p>
          <Button type="button" variant="primary" onClick={openUserProfile} disabled={busy}><L id="settings.manage_account" /></Button>
        </>}
      {accountStatus?.error && <div role="alert" className="d-alert"><p className="d-alert-text"><L id="settings.your_profile_details_could_not" /></p><div className="d-actions">{accountStatus.reload && <Button type="button" onClick={() => void accountStatus.reload?.()}><L id="settings.retry_profile" /></Button>}<Link href="/sign-in" className={buttonClass('secondary')}><L id="settings.sign_in_again" /></Link></div></div>}
    </section>
    <SpaceNames spaces={spaces} />
    {user && <section aria-labelledby="ts-session-h" className={panel}>
      <h2 id="ts-session-h" className="d-section"><L id="settings.your_session" /></h2>
      <p className="d-meta"><L id="settings.sign_out_of_edulabs_on" /></p>
      <Button type="button" onClick={() => void logout()} disabled={busy}><LogOut aria-hidden className="h-4 w-4" />{busy ? <L id="account.signingOut" /> : <L id="navigation.sign_out" />}</Button>
      {error && <p role="alert" className="d-field-error"><L text={error} /></p>}
    </section>}
  </div>;
}

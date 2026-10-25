'use client';

import { useState } from 'react';
import EduLabsMark from '@/frontend/components/edulabs-mark';
import { useLanguage } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';

export function TeacherInvitationAcceptance({ token, email }: { token: string; email: string }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const destination = '/teacher-invitation/' + token;

  async function accept() {
    if (busy || accepted) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/teacher-invitations/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ token }),
      });
      if (response.ok) { setAccepted(true); return; }
      const key: MessageKey = response.status === 401 ? 'ti.error.auth'
        : response.status === 403 ? 'ti.error.email'
        : response.status === 404 || response.status === 400 ? 'ti.error.invalid'
        : response.status === 409 ? 'ti.error.used'
        : response.status === 410 ? 'ti.error.gone'
        : 'ti.error.unavailable';
      setError(key);
    } catch { setError('ti.error.unavailable'); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto w-full max-w-xl overflow-hidden rounded-[26px] border-[2.5px] border-black bg-white text-[#17251a] shadow-[7px_7px_0_#17251a]">
    <header className="bg-[#7ed957] p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <EduLabsMark grow tone="ink" shadow={false} className="h-10 w-10" />
        <span className="font-display text-3xl leading-none">EduLabs</span>
      </div>
      <h1 className="font-display text-3xl leading-tight sm:text-4xl">{t(accepted ? 'ti.success.title' : 'ti.title')}</h1>
      <p className="mt-3 max-w-prose text-sm leading-6">{t(accepted ? 'ti.success.body' : 'ti.intro')}</p>
    </header>
    <section className="space-y-5 p-6 sm:p-8">
      {accepted ? <>
        <div role="status" className="rounded-xl border-2 border-[#b8d3a8] bg-[#f2f8ee] p-4 text-sm leading-6">{t('ti.success.body')}</div>
        <a href="/teacher/courses" className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-black bg-[#7ed957] px-4 py-3 text-center text-sm font-bold shadow-[3px_3px_0_#17251a]">{t('ti.success.continue')}</a>
      </> : <>
        <div className="rounded-xl border border-[#d9dfd4] bg-[#f6f8f3] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[#52634b]">{t('ti.signed_in_as')}</p>
          <p className="mt-1 break-all text-sm font-semibold" dir="ltr">{email}</p>
        </div>
        <p className="text-sm leading-6 text-[#354333]">{t('ti.email_note')}</p>
        <p className="text-sm leading-6 text-[#354333]">{t('ti.profile_note')}</p>
        {error ? <div role="alert" className="rounded-xl border-2 border-[#b42318] bg-[#fff3f1] p-4 text-sm leading-6 text-[#8d2018]">{t(error)}
          {error === 'ti.error.auth' ? <p className="mt-3"><a className="font-bold underline" href={'/sign-in?next=' + encodeURIComponent(destination)}>{t('ti.signin')}</a></p> : null}
        </div> : null}
        <button type="button" onClick={() => void accept()} disabled={busy} aria-busy={busy} className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-black bg-[#7ed957] px-4 py-3 text-sm font-bold shadow-[3px_3px_0_#17251a] disabled:cursor-wait disabled:opacity-60">
          {busy ? t('ti.accepting') : t('ti.accept')}
        </button>
        <p className="text-center text-xs leading-5 text-[#52634b]">{t('ti.privacy')}</p>
      </>}
    </section>
  </div>;
}

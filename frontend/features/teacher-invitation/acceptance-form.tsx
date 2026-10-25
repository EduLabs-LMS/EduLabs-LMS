'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import { useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';
import { Banner, Brand, Button, ButtonLink, Card, CardBody, CardHead, Field, Input, Page, PageHeader } from '@/frontend/design-system';
import { translateTeacherInvitation, type TeacherInvitationMessageKey } from '@/frontend/locales/teacher-invitation';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const storedTokenKey = 'edulabs-teacher-invitation-code';
const signInHref = '/sign-in?next=%2Faccept-teacher-invitation';
type Notice = { tone: 'error' | 'warn'; key: TeacherInvitationMessageKey };

const reasonMessages: Record<string, TeacherInvitationMessageKey> = {
  invalid: 'ti.error.invalid',
  not_found: 'ti.error.not_found',
  used: 'ti.error.used',
  gone: 'ti.error.gone',
  forbidden: 'ti.error.email_mismatch',
  unavailable: 'ti.error.unavailable',
};

export function TeacherInvitationAcceptance() {
  const router = useRouter();
  const { language } = useLanguage();
  const t = (key: TeacherInvitationMessageKey, values?: Record<string, string | number>) =>
    translateTeacherInvitation(language, key, values);
  const { user, loading, error: authError, logout } = useFirebaseAuth();
  const [token, setToken] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const operation = useRef(false);

  // Restore only a code intentionally carried through sign-in, then remove it from storage.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storedTokenKey);
      if (saved && tokenPattern.test(saved)) setToken(saved);
      sessionStorage.removeItem(storedTokenKey);
    } catch {
      // The teacher can always paste the code again; storage is never required to accept it.
    }
  }, []);

  function continueToSignIn() {
    const secret = token.trim();
    if (tokenPattern.test(secret)) {
      try {
        sessionStorage.setItem(storedTokenKey, secret);
      } catch {
        setNotice({ tone: 'error', key: 'ti.error.storage' });
        return;
      }
    }
    router.push(signInHref);
  }

  async function switchAccount() {
    const secret = token.trim();
    try {
      if (tokenPattern.test(secret)) sessionStorage.setItem(storedTokenKey, secret);
      sessionStorage.setItem('edulabs-auth-next', '/accept-teacher-invitation');
    } catch {
      if (tokenPattern.test(secret)) {
        setNotice({ tone: 'error', key: 'ti.error.storage' });
        return;
      }
    }
    try {
      await logout();
    } catch {
      // The logout handler has already signed out locally; continue to sign-in if its response failed.
      window.location.assign(signInHref);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current || busy || accepted || outcomeUnknown) return;
    const secret = token.trim();
    setAttempted(true);
    if (!tokenPattern.test(secret)) return;

    if (!user || !user.emailVerified) {
      continueToSignIn();
      return;
    }

    operation.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/teacher-invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ token: secret }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        continueToSignIn();
        return;
      }
      if (!response.ok) {
        const reason = payload && typeof payload === 'object' && 'reason' in payload && typeof payload.reason === 'string'
          ? payload.reason : '';
        setNotice({ tone: response.status === 410 ? 'warn' : 'error', key: reasonMessages[reason] ?? 'ti.error.unavailable' });
        return;
      }
      setAccepted(true);
      setToken('');
      setNotice(null);
      try { sessionStorage.removeItem(storedTokenKey); } catch { /* Best-effort cleanup only. */ }
    } catch {
      // Acceptance may have committed before the connection failed. Never encourage a blind retry.
      setOutcomeUnknown(true);
      setNotice({ tone: 'warn', key: 'ti.error.unknown' });
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  const signedIn = Boolean(user?.emailVerified);
  const invalidInput = attempted && !tokenPattern.test(token.trim());

  return (
    <main className="eds-root min-h-screen px-4 py-8 sm:px-8" data-appearance-island>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Brand />
          <span className="eds-meta">{t('ti.brand_note')}</span>
        </header>
        <Page layout="focused">
          <PageHeader title={t('ti.title')} intro={t('ti.intro')} />
          <Card labelledBy="ti-card-title">
            <CardHead id="ti-card-title" title={t('ti.card_title')} />
            <CardBody>
              {accepted ? (
                <div className="flex flex-col gap-4">
                  <Banner tone="ok" role="status">
                    <span className="flex items-center gap-2"><CheckCircle2 size={18} aria-hidden="true" /><strong>{t('ti.success.title')}</strong></span>
                  </Banner>
                  <p>{t('ti.success.body')}</p>
                  <div className="eds-actions">
                    <ButtonLink href="/home" variant="primary">{t('ti.success.home')} <ArrowRight size={16} aria-hidden="true" /></ButtonLink>
                  </div>
                </div>
              ) : (
                <>
                  {notice ? (
                    <Banner tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
                      <span>{t(notice.key)}</span>
                      {outcomeUnknown ? (
                        <Button size="sm" onClick={() => { setOutcomeUnknown(false); setNotice(null); }}>
                          {t('ti.error.retry_after_check')}
                        </Button>
                      ) : null}
                    </Banner>
                  ) : null}

                  {loading ? (
                    <Banner role="status">{t('ti.auth.loading')}</Banner>
                  ) : signedIn ? (
                    <Banner tone="ok" role="status">{t('ti.signed_in_as', { email: user?.email || t('ti.email_unavailable') })}</Banner>
                  ) : (
                    <Banner tone={authError ? 'error' : 'warn'} role={authError ? 'alert' : 'status'}>
                      <span>{user ? t('ti.account_unverified') : authError ? t('ti.auth.unavailable') : t('ti.sign_in_required')}</span>
                    </Banner>
                  )}

                  <form onSubmit={(event) => { void submit(event); }} className="flex flex-col gap-4">
                    <Field id="ti-code" label={t('ti.code_label')} hint={t('ti.code_hint')} error={invalidInput ? t('ti.error.invalid_input') : undefined}>
                      <Input
                        type="text"
                        value={token}
                        onChange={(event) => { setToken(event.target.value); setAttempted(false); if (!outcomeUnknown) setNotice(null); }}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="text"
                        dir="ltr"
                        maxLength={43}
                        disabled={busy || accepted || outcomeUnknown}
                        placeholder={t('ti.code_placeholder')}
                      />
                    </Field>
                    <p className="eds-hint">{t('ti.privacy_note')}</p>
                    <div className="eds-actions">
                      <Button type="submit" variant="primary" disabled={busy || loading || accepted || outcomeUnknown} aria-busy={busy}>
                        {busy ? <Loader2 size={16} className="eds-spin" aria-hidden="true" /> : signedIn ? <ShieldCheck size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                        {busy ? t('ti.working') : signedIn ? t('ti.accept') : t('ti.sign_in_accept')}
                      </Button>
                      {!signedIn ? (
                        <Button onClick={() => { if (tokenPattern.test(token.trim())) continueToSignIn(); else router.push(signInHref); }}>
                          {t('ti.sign_in')}
                        </Button>
                      ) : (
                        <Button onClick={() => { void switchAccount(); }}>
                          {t('ti.switch_account')}
                        </Button>
                      )}
                    </div>
                  </form>
                </>
              )}
            </CardBody>
          </Card>
        </Page>
      </div>
    </main>
  );
}

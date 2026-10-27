'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/frontend/components/language-provider';
import { useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';
import { Banner, Brand, Button, ButtonLink, Card, CardBody, CardHead, Field, Input, Page, PageHeader } from '@/frontend/design-system';
import { api } from '@/frontend/features/platform-admin/common';
import { accountRequest } from '@/frontend/lib/account';
import { clearInvitationToken, readInvitationToken, saveInvitationToken } from '@/frontend/lib/teacher-invitation-storage';
import { invitationFromHash, invitationPagePath } from '@/shared/invitation-link';
import type { AccountProfile } from '@/shared/contracts/account';
import type { InvitationPreview } from '@/shared/contracts/platform-provisioning';
import type { MessageKey } from '@/frontend/locales/messages';

type Phase =
 | { name: 'reading' }
 | { name: 'missing' }
 | { name: 'checking' }
 | { name: 'preview'; preview: InvitationPreview }
 | { name: 'accepting' }
 | { name: 'accepted' }
 | { name: 'unknown' }
 | { name: 'unreachable' };

const next = encodeURIComponent(invitationPagePath);
// An address inside Arabic text must keep its own left-to-right order.
const isolate = (value: string) => `\u2066${value}\u2069`;

/**
 * The invitation secret arrives in the URL fragment, is moved into short-lived browser storage so it survives the existing
 * sign-in / sign-up / Google / e-mail-verification flows, and is removed from the address bar. Every decision is made by the
 * server: this component only displays what the preview endpoint says and sends an explicit accept.
 */
export function TeacherInvitationView() {
 const { t } = useLanguage();
 const { user, loading, error, refresh, logout } = useFirebaseAuth();
 const [token, setToken] = useState<string | null>(null);
 const [storageNote, setStorageNote] = useState(false);
 const [phase, setPhase] = useState<Phase>({ name: 'reading' });
 const [busy, setBusy] = useState(false);
 const accepting = useRef(false);
 // The teacher's own name is collected here, before they accept, only when their account profile has none.
 const [profile, setProfile] = useState<AccountProfile | null>(null);
 const [profileFailed, setProfileFailed] = useState(false);
 const [names, setNames] = useState({ first: '', last: '' });
 const [nameState, setNameState] = useState<'idle' | 'saving' | 'invalid' | 'failed'>('idle');

 useEffect(() => {
  const fromLink = invitationFromHash(window.location.hash);
  if (fromLink) {
   const saved = saveInvitationToken(fromLink);
   setStorageNote(!saved);
   // Keep the fragment only when it could not be stored, so a reload does not lose the invitation.
   if (saved) window.history.replaceState(null, '', window.location.pathname);
   setToken(fromLink);
   setPhase({ name: 'checking' });
   return;
  }
  const stored = readInvitationToken();
  setToken(stored);
  setPhase(stored ? { name: 'checking' } : { name: 'missing' });
 }, []);

 const verified = !!user && user.emailVerified && !error;
 const check = useCallback(async (secret: string) => {
  setPhase({ name: 'checking' });
  const result = await api<InvitationPreview>('/api/teacher-invitations/preview', { method: 'POST', body: { token: secret } });
  if (!result.ok) { setPhase(result.status === 0 || result.status >= 500 ? { name: 'unreachable' } : { name: 'missing' }); return; }
  if (result.data.state === 'unavailable' || result.data.state === 'expired' || result.data.state === 'revoked') clearInvitationToken();
  setPhase({ name: 'preview', preview: result.data });
 }, []);

 useEffect(() => {
  if (token && verified && !loading && phase.name === 'checking') void check(token);
 }, [token, verified, loading, phase.name, check]);

 const loadProfile = useCallback(async () => {
  setProfileFailed(false);
  try { setProfile(await accountRequest('get')); } catch { setProfileFailed(true); }
 }, []);
 useEffect(() => {
  if (verified && !loading && !profile && !profileFailed) void loadProfile();
 }, [verified, loading, profile, profileFailed, loadProfile]);
 // Offer the sign-in provider's name as a starting point; the teacher confirms or changes it.
 useEffect(() => {
  if (!profile || profile.first_name.trim() || profile.last_name.trim() || !user?.displayName) return;
  const [first = '', ...rest] = user.displayName.trim().split(/\s+/);
  setNames((current) => (current.first || current.last ? current : { first, last: rest.join(' ') }));
 }, [profile, user?.displayName]);
 const needsName = !!profile && !(profile.first_name.trim() && profile.last_name.trim());

 async function saveName(event: React.FormEvent) {
  event.preventDefault();
  const first = names.first.trim(), last = names.last.trim();
  if (!profile || !first || !last || first.length > 60 || last.length > 60) { setNameState('invalid'); return; }
  setNameState('saving');
  try {
   const saved = await accountRequest('save', profile.revision, { firstName: first, lastName: last, completeOnboarding: true });
   setProfile(saved); setNameState('idle');
  } catch {
   // The profile may have changed elsewhere (for example in the account dialog): read it again so the next save uses its revision.
   await loadProfile(); setNameState('failed');
  }
 }

 async function accept() {
  if (!token || accepting.current) return;
  accepting.current = true; setBusy(true); setPhase({ name: 'accepting' });
  const result = await api<{ organizationId: string }>('/api/teacher-invitations/accept', { method: 'POST', body: { token } });
  accepting.current = false; setBusy(false);
  if (result.ok) { clearInvitationToken(); setPhase({ name: 'accepted' }); return; }
  // A network failure or server error may hide a successful acceptance: never resend, only look again.
  if (result.status === 0 || result.status >= 500) { setPhase({ name: 'unknown' }); return; }
  await check(token);
 }

 async function recheck() {
  if (!token) return;
  setBusy(true);
  try { await refresh(); } catch { /* the preview below reports the verified state */ }
  setBusy(false);
  setPhase({ name: 'checking' });
 }

 function Notice({ title, text, tone = 'info', working = false, action }: { title: MessageKey; text: MessageKey; tone?: 'info' | 'warn' | 'error'; working?: boolean; action?: React.ReactNode }) {
  return <Card emphasis labelledBy="ti-title" data-invitation-state={title}>
   <CardHead id="ti-title" title={t(title)} />
   <CardBody>
    <Banner tone={tone} role={tone === 'info' ? 'status' : 'alert'}>{t(text)}</Banner>
    {working ? <p className="eds-hint" aria-busy="true">{t('ti.please_wait')}</p> : null}
    {action ? <div className="eds-actions">{action}</div> : null}
   </CardBody>
  </Card>;
 }
 const verifyAction = <Button variant="primary" disabled={busy} onClick={() => void recheck()}>{t('ti.verify.done')}</Button>;
 const home = <ButtonLink href="/home" variant="secondary">{t('ti.open_home')}</ButtonLink>;

 function body() {
  if (phase.name === 'reading' || (phase.name !== 'missing' && loading)) return <Notice title="ti.checking.title" text="ti.checking.text" working />;
  if (phase.name === 'missing') return <Notice title="ti.missing.title" text="ti.missing.text" tone="warn" action={home} />;
  if (!user) {
   return <Card emphasis labelledBy="ti-title" data-invitation-state="sign-in">
    <CardHead id="ti-title" title={t('ti.signin.title')} />
    <CardBody>
     <p>{t('ti.signin.text')}</p>
     <div className="eds-actions">
      <ButtonLink href={`/sign-in?next=${next}`} variant="primary">{t('ti.signin.sign_in')}</ButtonLink>
      <ButtonLink href={`/sign-up?next=${next}`} variant="secondary">{t('ti.signin.sign_up')}</ButtonLink>
     </div>
     <p className="eds-hint">{t('ti.signin.same_email')}</p>
    </CardBody>
   </Card>;
  }
  if (!user.emailVerified) return <Notice title="ti.verify.title" text="ti.verify.text" tone="warn" action={verifyAction} />;
  if (phase.name === 'unreachable') return <Notice title="ti.unreachable.title" text="ti.unreachable.text" tone="error" action={<Button variant="primary" onClick={() => token && void check(token)}>{t('ti.retry')}</Button>} />;
  if (phase.name === 'unknown') return <Notice title="ti.unknown.title" text="ti.unknown.text" tone="warn" action={<Button variant="primary" disabled={busy} onClick={() => token && void check(token)}>{t('ti.check_status')}</Button>} />;
  if (phase.name === 'accepted') return success(false);
  if (phase.name === 'checking' || phase.name === 'accepting') return <Notice title={phase.name === 'accepting' ? 'ti.accepting.title' : 'ti.checking.title'} text="ti.checking.text" working />;
  const p = phase.preview;
  if (p.state === 'used') return p.acceptedByMe ? success(true) : <Notice title="ti.used.title" text="ti.used.text" tone="warn" action={home} />;
  if (p.state === 'expired') return <Notice title="ti.expired.title" text="ti.expired.text" tone="warn" />;
  if (p.state === 'revoked') return <Notice title="ti.revoked.title" text="ti.revoked.text" tone="warn" />;
  if (p.state === 'unavailable') return <Notice title="ti.unavailable.title" text="ti.unavailable.text" tone="warn" />;
  if (!p.emailVerified) return <Notice title="ti.verify.title" text="ti.verify.text" tone="warn" action={verifyAction} />;
  if (!p.emailMatches) {
   return <Card emphasis labelledBy="ti-title" data-invitation-state="wrong-email">
    <CardHead id="ti-title" title={t('ti.wrong.title')} />
    <CardBody>
     <Banner tone="warn" role="alert">{t('ti.wrong.text', { email: isolate(p.maskedEmail ?? '') })}</Banner>
     <div className="eds-actions"><Button variant="primary" onClick={() => void logout().catch(() => window.location.assign('/sign-in'))}>{t('ti.wrong.switch')}</Button></div>
    </CardBody>
   </Card>;
  }
  if (profileFailed) return <Notice title="ti.unreachable.title" text="ti.unreachable.text" tone="error" action={<Button variant="primary" onClick={() => void loadProfile()}>{t('ti.retry')}</Button>} />;
  if (!profile) return <Notice title="ti.checking.title" text="ti.name.loading" working />;
  if (needsName) {
   return <Card emphasis labelledBy="ti-title" data-invitation-state="name">
    <CardHead id="ti-title" title={t('ti.name.title')} />
    <CardBody>
     <p>{t('ti.name.text')}</p>
     <form onSubmit={(event) => void saveName(event)} noValidate className="pa-system">
      <Field id="ti-first-name" label={t('ti.name.first')} error={nameState === 'invalid' && !names.first.trim() ? t('ti.name.invalid') : undefined}>
       <Input autoComplete="given-name" maxLength={60} value={names.first} onChange={(e) => setNames({ ...names, first: e.target.value })} />
      </Field>
      <Field id="ti-last-name" label={t('ti.name.last')} error={nameState === 'invalid' && !names.last.trim() ? t('ti.name.invalid') : undefined}>
       <Input autoComplete="family-name" maxLength={60} value={names.last} onChange={(e) => setNames({ ...names, last: e.target.value })} />
      </Field>
      {nameState === 'failed' ? <Banner tone="error" role="alert">{t('ti.name.failed')}</Banner> : null}
      <div className="eds-actions"><Button variant="primary" type="submit" disabled={nameState === 'saving'} aria-busy={nameState === 'saving'}>{t('ti.name.save')}</Button></div>
     </form>
    </CardBody>
   </Card>;
  }
  return <Card emphasis labelledBy="ti-title" data-invitation-state="valid">
   <CardHead id="ti-title" title={t('ti.valid.title')} />
   <CardBody>
    <p>{t('ti.valid.text')}</p>
    <p className="eds-hint">{t('ti.valid.for', { email: isolate(p.maskedEmail ?? '') })}</p>
    <div className="eds-actions"><Button variant="primary" disabled={busy} onClick={() => void accept()}>{t('ti.accept')}</Button></div>
   </CardBody>
  </Card>;
 }
 function success(again: boolean) {
  return <Card emphasis labelledBy="ti-title" data-invitation-state="accepted">
   <CardHead id="ti-title" title={t(again ? 'ti.success.again_title' : 'ti.success.title')} />
   <CardBody>
    <Banner tone="ok" role="status">{t('ti.success.text')}</Banner>
    <div className="eds-actions"><ButtonLink href="/teacher/courses" variant="primary">{t('ti.success.open')}</ButtonLink></div>
   </CardBody>
  </Card>;
 }

 return <div className="eds-root pa-invite" data-appearance-island data-teacher-invitation>
  <Page layout="focused">
   <header className="pa-invite-brand"><Link href="/" aria-label={t('pa.brand')}><Brand /></Link></header>
   <main>
    <PageHeader title={t('ti.page_title')} />
    {body()}
    {storageNote ? <Banner tone="warn" role="note">{t('ti.storage_note')}</Banner> : null}
   </main>
  </Page>
 </div>;
}

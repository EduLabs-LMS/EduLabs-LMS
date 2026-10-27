'use client';

import { useState } from 'react';
import { ArrowLeft, Link2, Loader2, Mail } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import { Badge, Banner, Button, ButtonLink, Page, Card, CardBody, CardHead, Chip, ChipList, DefinitionList, Field, Input, PageHeader, Select } from '@/frontend/design-system';
import type { MessageKey } from '@/frontend/locales/messages';
import { invitationLifetimes, type CopyLinkResult, type InvitationStatus, type DeliveryStatus, type PortalDetail, type ReissueResult, type SendEmailResult } from '@/shared/contracts/platform-provisioning';
import { InvitationLinkCard, StatusBadge, UtcDate, api, reasonMessage } from './common';

const activityKey: Record<string, MessageKey> = {
 'portal.provision': 'pa.activity.provision', 'invitation.reissue': 'pa.activity.reissue', 'invitation.revoke': 'pa.activity.revoke', 'invitation.accept': 'pa.activity.accept',
};
/** A write whose response never arrived: what we knew before it, so a refresh can tell what really happened. */
type Unknown = { action: 'reissue' | 'revoke' | 'send_email'; baselineId: string | undefined; baselineStatus: InvitationStatus | undefined; baselineAttempts: number };

const deliveryTone: Record<DeliveryStatus, 'neutral' | 'pending' | 'ok' | 'off'> = { not_sent: 'neutral', sending: 'pending', sent: 'ok', failed: 'off' };
const deliveryLabel: Record<DeliveryStatus, MessageKey> = { not_sent: 'pa.delivery.not_sent', sending: 'pa.delivery.sending', sent: 'pa.delivery.sent', failed: 'pa.delivery.failed' };
const deliveryNote: Record<DeliveryStatus, MessageKey> = { not_sent: 'pa.delivery.not_sent_note', sending: 'pa.delivery.sending_note', sent: 'pa.delivery.sent_note', failed: 'pa.delivery.failed_note' };
/** What the e-mail provider actually told the server; never inferred from the click. */
function DeliveryState({ delivery }: { delivery: PortalDetail['invitations'][number]['delivery'] }) {
 const { t } = useLanguage();
 return <span className="pa-delivery-state"><Badge tone={deliveryTone[delivery.status]} data-delivery={delivery.status}>{t(deliveryLabel[delivery.status])}</Badge>{delivery.attemptedAt ? <> <UtcDate value={delivery.attemptedAt} /></> : null}</span>;
}

export function PortalView({ initial, portalId }: { initial: PortalDetail; portalId: string }) {
 const { t } = useLanguage();
 const [detail, setDetail] = useState(initial);
 const [busy, setBusy] = useState<'revoke' | 'reissue' | 'email' | 'link' | 'refresh' | null>(null);
 const [confirmRevoke, setConfirmRevoke] = useState(false);
 const [reissue, setReissue] = useState({ open: false, days: 7, email: '' });
 const [link, setLink] = useState<Pick<ReissueResult | CopyLinkResult, 'invitationLink' | 'expiresAt'> | null>(null);
 const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'warn'; key: MessageKey } | null>(null);
 const [unknown, setUnknown] = useState<Unknown | null>(null);
 const [replacement, setReplacement] = useState(false);
 const latest = detail.invitations[0];
 const pending = latest?.status === 'pending';
 const accepted = detail.invitations.some((i) => i.status === 'accepted');
 const locked = busy !== null || unknown !== null;

 // A successful write is never reported as failed just because the follow-up read failed.
 async function reload(done: MessageKey, tone: 'ok' | 'warn' | 'error' = 'ok') {
  const out = await api<PortalDetail>(`/api/platform-admin/portals/${portalId}`);
  if (out.ok) { setDetail(out.data); setNotice({ tone, key: done }); } else setNotice({ tone: 'warn', key: 'pa.portal.refresh_failed' });
 }
 const failure = (reason: Parameters<typeof reasonMessage>[0] | 'network') => setNotice({ tone: 'error', key: reason === 'network' ? 'pa.err.network' : reasonMessage(reason) });

 async function revoke() {
  const baseline: Unknown = { action: 'revoke', baselineId: latest?.id, baselineStatus: latest?.status, baselineAttempts: latest?.delivery.attempts ?? 0 };
  setBusy('revoke'); setNotice(null);
  const out = await api<unknown>(`/api/platform-admin/portals/${portalId}`, { method: 'POST', body: { action: 'revoke' } });
  setBusy(null); setConfirmRevoke(false);
  if (out.ok) { setLink(null); await reload('pa.portal.revoked'); return; }
  if (out.reason === 'network') { setUnknown(baseline); return; }
  failure(out.reason);
 }
 /** The ONLY rotation: issues a brand-new link (the old link and any e-mail carrying it stop working) without sending anything. */
 async function issueLink(source: 'reissue', days: number, teacherEmail?: string) {
  const baseline: Unknown = { action: 'reissue', baselineId: latest?.id, baselineStatus: latest?.status, baselineAttempts: latest?.delivery.attempts ?? 0 };
  setBusy(source); setNotice(null);
  const out = await api<ReissueResult>(`/api/platform-admin/portals/${portalId}`, { method: 'POST', body: { action: 'reissue', expiresInDays: days, ...(teacherEmail ? { teacherEmail } : {}) } });
  setBusy(null);
  if (out.ok) {
   setLink(out.data); setReplacement(false); setReissue({ open: false, days: 7, email: '' });
   try { await navigator.clipboard.writeText(out.data.invitationLink); } catch { /* the link card has an explicit copy button */ }
   await reload('pa.portal.reissued'); return;
  }
  if (out.reason === 'network') { setUnknown(baseline); setReissue({ ...reissue, open: false }); return; }
  failure(out.reason);
 }
 const reissueNow = () => issueLink('reissue', reissue.days, reissue.email.trim() || undefined);
 /** E-mails the SAME active link to the recorded address. Nothing is replaced; the outcome is recorded by the server, never assumed. */
 async function sendEmail() {
  const baseline: Unknown = { action: 'send_email', baselineId: latest?.id, baselineStatus: latest?.status, baselineAttempts: latest?.delivery.attempts ?? 0 };
  setBusy('email'); setNotice(null);
  const out = await api<SendEmailResult>(`/api/platform-admin/portals/${portalId}`, { method: 'POST', body: { action: 'send_email' } });
  setBusy(null);
  if (out.ok) {
   const { delivery, statusSaved } = out.data;
   if (delivery === 'sent') await reload(statusSaved ? 'pa.portal.email_sent' : 'pa.portal.email_sent_unsaved', statusSaved ? 'ok' : 'warn');
   else if (delivery === 'failed') await reload(statusSaved ? 'pa.portal.email_failed' : 'pa.portal.email_failed_unsaved', 'error');
   else await reload('pa.portal.email_unconfirmed', 'warn');
   return;
  }
  if (out.reason === 'network') { setUnknown(baseline); return; }
  failure(out.reason);
 }
 /** Shows the same active link again. Read-only on the server: nothing is created, replaced or sent, so a failed or interrupted copy is harmless to repeat. */
 async function copyLink() {
  setBusy('link'); setNotice(null);
  const out = await api<CopyLinkResult>(`/api/platform-admin/portals/${portalId}`, { method: 'POST', body: { action: 'copy_link' } });
  setBusy(null);
  if (!out.ok) { failure(out.reason); return; }
  setLink(out.data);
  try { await navigator.clipboard.writeText(out.data.invitationLink); } catch { /* the link card has an explicit copy button */ }
  setNotice({ tone: 'ok', key: 'pa.portal.link_copied' });
 }
 /** Read-only: asks the server what the invitation looks like now and explains what that means. */
 async function checkStatus() {
  if (!unknown) return;
  setBusy('refresh'); setNotice(null);
  const out = await api<PortalDetail>(`/api/platform-admin/portals/${portalId}`);
  setBusy(null);
  if (!out.ok) { setNotice({ tone: 'error', key: 'pa.portal.unknown_refresh_failed' }); return; }
  const now = out.data.invitations[0];
  setDetail(out.data);
  if (out.data.invitations.some((i) => i.status === 'accepted') && unknown.baselineStatus !== 'accepted') setNotice({ tone: 'warn', key: 'pa.portal.outcome_accepted' });
  else if (unknown.action === 'revoke') setNotice(now?.status === 'revoked' ? { tone: 'ok', key: 'pa.portal.outcome_revoke_done' } : now?.status === 'expired' ? { tone: 'warn', key: 'pa.portal.outcome_expired' } : { tone: 'warn', key: 'pa.portal.outcome_revoke_none' });
  else if (unknown.action === 'send_email') setNotice(now?.id !== unknown.baselineId ? { tone: 'warn', key: 'pa.portal.outcome_send_changed' } : (now?.delivery.attempts ?? 0) > unknown.baselineAttempts ? { tone: 'warn', key: 'pa.portal.outcome_send_recorded' } : { tone: 'ok', key: 'pa.portal.outcome_send_none' });
  else if (now?.id !== unknown.baselineId) { setNotice({ tone: 'warn', key: 'pa.portal.outcome_reissue_lost' }); setReplacement(true); }
  else setNotice({ tone: 'ok', key: 'pa.portal.outcome_reissue_none' });
  setUnknown(null);
 }
 /** Deliberate recovery for a code that was generated but never reached the administrator. */
 const openReplacement = () => { setReissue({ ...reissue, open: true }); setConfirmRevoke(false); };

 return <Page layout="wide">
  <PageHeader title={<bdi dir="ltr">{latest?.teacherEmail}</bdi>} intro={t(detail.hasOwner ? 'pa.portal.owner_active' : 'pa.portal.owner_pending')}
   actions={<ButtonLink href="/platform-admin/teachers" variant="ghost"><ArrowLeft size={16} className="eds-flip" aria-hidden="true" />{t('pa.portal.back')}</ButtonLink>} />
  {notice ? <Banner tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{t(notice.key)}</Banner> : null}
  {unknown ? <Banner tone="warn" role="alert">
   <span><strong>{t('pa.portal.unknown_title')}</strong><br />{t(unknown.action === 'revoke' ? 'pa.portal.unknown_revoke' : unknown.action === 'send_email' ? 'pa.portal.unknown_send' : 'pa.portal.unknown_reissue')}</span>
   <Button variant="primary" size="sm" onClick={checkStatus} disabled={busy !== null} aria-busy={busy === 'refresh'}>
    {busy === 'refresh' ? <Loader2 size={14} className="eds-spin" aria-hidden="true" /> : null}{t('pa.portal.refresh_status')}</Button>
  </Banner> : null}
  {replacement && !link ? <Banner tone="warn" role="status">
   <span>{t('pa.portal.replacement_hint')}</span>
   {!reissue.open ? <Button size="sm" onClick={openReplacement} disabled={locked}>{t('pa.portal.issue_replacement')}</Button> : null}
  </Banner> : null}
  {link ? <InvitationLinkCard link={link.invitationLink} expiresAt={link.expiresAt} onDone={() => setLink(null)} /> : null}

  <div className="pa-split">
   <div className="pa-stack">
    <Card labelledBy="pa-p-edu">
     <CardHead id="pa-p-edu" title={t('pa.portal.education')} />
     <CardBody divided>
      {detail.educationSystems.map((s) => <div key={s.id} className="pa-system">
       <div><span className="eds-strong">{s.name}</span>{s.examinationBoard ? <span className="eds-meta"> · {s.examinationBoard}</span> : null}</div>
       <ChipList label={s.name}>{s.gradeLevels.map((g) => <Chip key={g.id}>{g.name}</Chip>)}</ChipList>
      </div>)}
      <div className="pa-system"><span className="eds-strong">{t('pa.section.subjects')}</span><ChipList label={t('pa.section.subjects')}>{detail.subjects.map((s) => <Chip key={s.id}>{s.name}</Chip>)}</ChipList></div>
     </CardBody>
    </Card>
    <Card labelledBy="pa-p-courses">
     <CardHead id="pa-p-courses" title={t('pa.portal.courses')} />
     <CardBody divided>
      {detail.courses.map((c) => <div key={c.id}><span className="eds-strong">{c.title}</span>
       <span className="eds-meta eds-block">{[c.educationSystem, c.gradeLevel, c.subject].filter(Boolean).join(' · ')} · {t('pa.portal.course_empty')}</span></div>)}
     </CardBody>
    </Card>
   </div>

   <div className="pa-stack">
    <Card labelledBy="pa-p-inv" emphasis={pending}>
     <CardHead id="pa-p-inv" title={t('pa.portal.invitation')} aside={latest ? <StatusBadge status={latest.status} /> : null} />
     <CardBody>
      {latest ? <DefinitionList items={[
       { key: 'e', term: t('pa.field.email'), detail: <bdi dir="ltr">{latest.teacherEmail}</bdi> },
       { key: 'x', term: t('pa.portal.expires'), detail: <UtcDate value={latest.expiresAt} /> },
       ...(latest.acceptedAt ? [{ key: 'a', term: t('pa.portal.accepted_at'), detail: <UtcDate value={latest.acceptedAt} /> }] : []),
      ]} /> : null}
      {latest ? <div className="pa-delivery" data-invitation-delivery><span className="eds-strong">{t('pa.portal.sent')}</span><DeliveryState delivery={latest.delivery} /></div> : null}
      {latest && !accepted ? <p className="eds-hint" data-delivery-note>{t(deliveryNote[latest.delivery.status])}</p> : null}
      {!accepted ? <div className="pa-system" data-invitation-share>
       <div className="eds-actions">
        <Button variant="primary" onClick={sendEmail} disabled={locked || !pending} aria-busy={busy === 'email'}>{busy === 'email' ? <Loader2 size={16} className="eds-spin" aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}{t(latest && latest.delivery.status !== 'not_sent' ? 'pa.portal.send_again' : 'pa.portal.send_email')}</Button>
        <Button onClick={() => void copyLink()} disabled={locked || !pending} aria-busy={busy === 'link'}>{busy === 'link' ? <Loader2 size={16} className="eds-spin" aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}{t('pa.portal.copy_link')}</Button>
       </div>
       <p className="eds-hint">{t('pa.portal.share_hint')}</p>
      </div> : null}
      {!accepted ? <div className="eds-actions">
       <Button onClick={() => { setReissue({ ...reissue, open: !reissue.open }); setConfirmRevoke(false); }} aria-expanded={reissue.open} disabled={locked}>{t('pa.portal.reissue')}</Button>
       {pending ? <Button variant="danger" onClick={() => { setConfirmRevoke(true); setReissue({ ...reissue, open: false }); }} disabled={locked}>{t('pa.portal.revoke')}</Button> : null}
      </div> : <p className="eds-hint">{t('pa.portal.accepted_note')}</p>}
      {unknown ? <p className="eds-hint">{t('pa.portal.locked_hint')}</p> : null}
      {confirmRevoke ? <Banner tone="warn" role="group">
       <span>{t('pa.portal.revoke_confirm')}</span>
       <span className="eds-actions">
        <Button variant="danger" size="sm" onClick={revoke} disabled={busy !== null} aria-busy={busy === 'revoke'}>{busy === 'revoke' ? <Loader2 size={14} className="eds-spin" aria-hidden="true" /> : null}{t('pa.portal.revoke_yes')}</Button>
        <Button size="sm" onClick={() => setConfirmRevoke(false)} disabled={busy !== null}>{t('pa.action.cancel')}</Button>
       </span>
      </Banner> : null}
      {reissue.open ? <div className="pa-system">
       <p className="eds-hint">{t(replacement ? 'pa.portal.replacement_hint' : 'pa.portal.reissue_hint')}</p>
       <Field id="pa-re-days" label={t('pa.field.lifetime')}>
        <Select value={reissue.days} onChange={(e) => setReissue({ ...reissue, days: Number(e.target.value) })}>{invitationLifetimes.map((n) => <option key={n} value={n}>{t('pa.lifetime.days', { count: n })}</option>)}</Select>
       </Field>
       <Field id="pa-re-email" label={t('pa.portal.new_email')} hint={t('pa.portal.new_email_hint')}>
        <Input type="email" dir="ltr" autoComplete="off" value={reissue.email} onChange={(e) => setReissue({ ...reissue, email: e.target.value })} />
       </Field>
       <div className="eds-actions">
        <Button variant="primary" onClick={reissueNow} disabled={locked} aria-busy={busy === 'reissue'}>{busy === 'reissue' ? <Loader2 size={16} className="eds-spin" aria-hidden="true" /> : null}{t('pa.portal.reissue_go')}</Button>
        <Button onClick={() => setReissue({ ...reissue, open: false })} disabled={busy !== null}>{t('pa.action.cancel')}</Button>
       </div>
      </div> : null}
     </CardBody>
    </Card>
    <Card labelledBy="pa-p-activity">
     <CardHead id="pa-p-activity" title={t('pa.portal.activity')} />
     <CardBody divided>
      {detail.activity.map((a, i) => <div key={`${a.occurredAt}-${i}`}>
       <span className="eds-strong">{activityKey[a.action] ? t(activityKey[a.action]) : a.action}</span>
       <span className="eds-meta eds-block">{t(a.actor === 'administrator' ? 'pa.actor.administrator' : 'pa.actor.teacher')} · <UtcDate value={a.occurredAt} /></span>
      </div>)}
     </CardBody>
    </Card>
   </div>
  </div>
 </Page>;
}

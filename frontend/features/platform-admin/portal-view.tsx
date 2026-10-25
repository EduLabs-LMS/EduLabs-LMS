'use client';

import { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import { Banner, Button, ButtonLink, Page, Card, CardBody, CardHead, Chip, ChipList, DefinitionList, Field, Input, PageHeader, Select } from '@/frontend/design-system';
import type { MessageKey } from '@/frontend/locales/messages';
import { invitationLifetimes, type InvitationStatus, type PortalDetail, type ReissueResult } from '@/shared/contracts/platform-provisioning';
import { SecretCard, StatusBadge, UtcDate, api, reasonMessage } from './common';

const activityKey: Record<string, MessageKey> = {
 'portal.provision': 'pa.activity.provision', 'invitation.reissue': 'pa.activity.reissue', 'invitation.revoke': 'pa.activity.revoke', 'invitation.accept': 'pa.activity.accept',
};
/** A write whose response never arrived: what we knew before it, so a refresh can tell what really happened. */
type Unknown = { action: 'reissue' | 'revoke' | 'send-email'; baselineId: string | undefined; baselineStatus: InvitationStatus | undefined };

export function PortalView({ initial, portalId }: { initial: PortalDetail; portalId: string }) {
 const { t } = useLanguage();
 const [detail, setDetail] = useState(initial);
 const [busy, setBusy] = useState<'revoke' | 'reissue' | 'send' | 'refresh' | null>(null);
 const [confirmRevoke, setConfirmRevoke] = useState(false);
 const [confirmSend, setConfirmSend] = useState(false);
 const [reissue, setReissue] = useState({ open: false, days: 7, email: '' });
 const [secret, setSecret] = useState<ReissueResult | null>(null);
 const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'warn'; key: MessageKey } | null>(null);
 const [unknown, setUnknown] = useState<Unknown | null>(null);
 const [replacement, setReplacement] = useState(false);
 const latest = detail.invitations[0];
 const pending = latest?.status === 'pending';
 const accepted = detail.invitations.some((i) => i.status === 'accepted');
 const locked = busy !== null || unknown !== null;

 // A successful write is never reported as failed just because the follow-up read failed.
 async function reload(done: MessageKey) {
  const out = await api<PortalDetail>(`/api/platform-admin/portals/${portalId}`);
  if (out.ok) { setDetail(out.data); setNotice({ tone: 'ok', key: done }); } else setNotice({ tone: 'warn', key: 'pa.portal.refresh_failed' });
 }
 const failure = (reason: Parameters<typeof reasonMessage>[0] | 'network') => setNotice({ tone: 'error', key: reason === 'network' ? 'pa.err.network' : reasonMessage(reason) });

 async function revoke() {
  const baseline: Unknown = { action: 'revoke', baselineId: latest?.id, baselineStatus: latest?.status };
  setBusy('revoke'); setNotice(null);
  const out = await api<unknown>(`/api/platform-admin/portals/${portalId}`, { method: 'POST', body: { action: 'revoke' } });
  setBusy(null); setConfirmRevoke(false);
  if (out.ok) { setSecret(null); await reload('pa.portal.revoked'); return; }
  if (out.reason === 'network') { setUnknown(baseline); return; }
  failure(out.reason);
 }
 async function reissueNow() {
  const baseline: Unknown = { action: 'reissue', baselineId: latest?.id, baselineStatus: latest?.status };
  setBusy('reissue'); setNotice(null);
  const email = reissue.email.trim();
  const out = await api<ReissueResult>(`/api/platform-admin/portals/${portalId}`, { method: 'POST', body: { action: 'reissue', expiresInDays: reissue.days, ...(email ? { teacherEmail: email } : {}) } });
  setBusy(null);
  if (out.ok) { setSecret(out.data); setReplacement(false); setConfirmSend(false); setReissue({ open: false, days: 7, email: '' }); await reload('pa.portal.reissued'); return; }
  if (out.reason === 'network') { setUnknown(baseline); setReissue({ ...reissue, open: false }); return; }
  failure(out.reason);
 }
 async function sendEmailNow() {
  const baseline: Unknown = { action: 'send-email', baselineId: latest?.id, baselineStatus: latest?.status };
  setBusy('send'); setNotice(null);
  const out = await api<ReissueResult>(`/api/platform-admin/portals/${portalId}`, { method: 'POST', body: { action: 'send-email', expiresInDays: 7 } });
  setBusy(null);
  if (out.ok) {
   setSecret(out.data); setConfirmSend(false); setReplacement(false);
   const fresh = await api<PortalDetail>(`/api/platform-admin/portals/${portalId}`);
   if (fresh.ok) setDetail(fresh.data);
   setNotice({ tone: out.data.delivery === 'sent' ? 'ok' : 'warn', key: out.data.delivery === 'sent' ? 'pa.portal.email_sent' : 'pa.portal.email_failed' });
   return;
  }
  if (out.reason === 'network' || out.reason === 'unavailable') { setSecret(null); setUnknown(baseline); setConfirmSend(false); return; }
  setConfirmSend(false); failure(out.reason);
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
  else if (unknown.action === 'send-email') {
   if (now?.id !== unknown.baselineId) { setNotice({ tone: 'warn', key: 'pa.portal.outcome_email_unknown' }); setReplacement(true); }
   else { setNotice({ tone: 'ok', key: 'pa.portal.outcome_email_not_started' }); setReplacement(true); }
  }
  else if (unknown.action === 'revoke') setNotice(now?.status === 'revoked' ? { tone: 'ok', key: 'pa.portal.outcome_revoke_done' } : now?.status === 'expired' ? { tone: 'warn', key: 'pa.portal.outcome_expired' } : { tone: 'warn', key: 'pa.portal.outcome_revoke_none' });
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
   <span><strong>{t('pa.portal.unknown_title')}</strong><br />{t(unknown.action === 'revoke' ? 'pa.portal.unknown_revoke' : unknown.action === 'send-email' ? 'pa.portal.unknown_send_email' : 'pa.portal.unknown_reissue')}</span>
   <Button variant="primary" size="sm" onClick={checkStatus} disabled={busy !== null} aria-busy={busy === 'refresh'}>
    {busy === 'refresh' ? <Loader2 size={14} className="eds-spin" aria-hidden="true" /> : null}{t('pa.portal.refresh_status')}</Button>
  </Banner> : null}
  {replacement && !secret ? <Banner tone="warn" role="status">
   <span>{t('pa.portal.replacement_hint')}</span>
   {!reissue.open ? <Button size="sm" onClick={openReplacement} disabled={locked}>{t('pa.portal.issue_replacement')}</Button> : null}
  </Banner> : null}
  {secret ? <SecretCard secret={secret.invitationSecret} expiresAt={secret.expiresAt} delivery={secret.delivery} onDone={() => setSecret(null)} /> : null}

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
       { key: 's', term: t('pa.portal.sent'), detail: t('pa.portal.not_sent') },
       { key: 'x', term: t('pa.portal.expires'), detail: <UtcDate value={latest.expiresAt} /> },
       ...(latest.acceptedAt ? [{ key: 'a', term: t('pa.portal.accepted_at'), detail: <UtcDate value={latest.acceptedAt} /> }] : []),
      ]} /> : null}
      {!accepted ? <div className="eds-actions">
       <Button onClick={() => { setConfirmSend(true); setReissue({ ...reissue, open: false }); setConfirmRevoke(false); }} disabled={locked}>{t('pa.portal.send_email')}</Button>
       <Button onClick={() => { setReissue({ ...reissue, open: !reissue.open }); setConfirmRevoke(false); setConfirmSend(false); }} aria-expanded={reissue.open} disabled={locked}>{t('pa.portal.reissue')}</Button>
       {pending ? <Button variant="danger" onClick={() => { setConfirmRevoke(true); setReissue({ ...reissue, open: false }); setConfirmSend(false); }} disabled={locked}>{t('pa.portal.revoke')}</Button> : null}
      </div> : <p className="eds-hint">{t('pa.portal.accepted_note')}</p>}
      {confirmSend ? <Banner tone="warn" role="group">
       <span>{t('pa.portal.send_email_confirm', { email: latest?.teacherEmail ?? '' })}</span>
       <span className="eds-actions">
        <Button variant="primary" onClick={sendEmailNow} disabled={busy !== null} aria-busy={busy === 'send'}>
         {busy === 'send' ? <Loader2 size={14} className="eds-spin" aria-hidden="true" /> : null}{t(busy === 'send' ? 'pa.portal.sending_email' : 'pa.portal.send_email_confirm_yes')}
        </Button>
        <Button onClick={() => setConfirmSend(false)} disabled={busy !== null}>{t('pa.action.cancel')}</Button>
       </span>
      </Banner> : null}
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

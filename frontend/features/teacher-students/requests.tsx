'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Avatar } from '@/frontend/components/design/avatar';
import { Button } from '@/frontend/components/design/button';
import { Icon } from '@/frontend/components/design/icon';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Select } from '@/frontend/components/design/controls';
import { GroupError, useCommand } from '@/frontend/features/teacher-groups/parts';
import type { StudyGroup } from '@/shared/contracts/groups';
import { approvalGroups, approveOutcome, type ApproveOutcome } from '@/shared/teacher-students';
import { adminCall, groupCall, newRequestId } from './api';
import type { PendingRequest } from './data';
import { StudentName, useDate } from './parts';

export type Notice = { id: string; outcome: ApproveOutcome | 'rejected'; name: string | null; groupId?: string; groupName?: string };

/** One waiting request. Approve can also put the student in a Group of that course; the two steps are separate and never undo each other. */
function RequestItem({ item, groups, groupsError, label, onDone, onStale, onNotice }: {
  item: PendingRequest; groups: readonly StudyGroup[]; groupsError: boolean; label: string; onDone: () => void; onStale: () => void; onNotice: (n: Notice) => void;
}) {
  const { t } = useLanguage();
  const { request, offering } = item;
  const date = useDate();
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [groupId, setGroupId] = useState('');
  const [reason, setReason] = useState('');
  const [needReason, setNeedReason] = useState(false);
  // One attempt keeps one request id until it succeeds, so pressing the button again after a lost reply can never decide the request twice.
  const attempt = useRef<string | null>(null);
  const { busy, error, run } = useCommand(onDone);
  const choices = approvalGroups(groups, offering.id);

  const approve = () => void run(async () => {
    const requestId = attempt.current ??= newRequestId();
    await adminCall('approve', { expiresAt: null }, { offeringId: offering.id, subjectId: request.user_id, version: request.version, requestId });
    attempt.current = null;
    let added: boolean | null = null;
    const group = choices.find(g => g.id === groupId);
    if (group) {
      added = false;
      try {
        const detail = await groupCall<{ group: StudyGroup }>('view', group.id, { section: 'detail' });
        await groupCall('add', group.id, { userId: request.user_id }, detail.group.version);
        added = true;
      } catch { added = false; }
    }
    onNotice({ id: request.id, outcome: approveOutcome(true, added), name: request.display_name, groupId: group?.id, groupName: group?.name });
    // "Approved, but not added" is not finished: it stays on the page and asks for something, so it gets no toast.
    if (added || !group) actionToast(group ? t('ts.requests.approved_in', { group: group.name }) : t('ts.requests.approved'));
  });
  const reject = () => {
    if (!reason.trim()) { setNeedReason(true); return; }
    void run(async () => {
      const requestId = attempt.current ??= newRequestId();
      await adminCall('reject', { reason: reason.trim() }, { offeringId: offering.id, subjectId: request.user_id, version: request.version, requestId });
      attempt.current = null;
      onNotice({ id: request.id, outcome: 'rejected', name: request.display_name });
      actionToast(t('ts.requests.rejected'));
    });
  };

  return <li data-request={request.id} className="d-request">
    <div className="d-request-main">
      <Avatar id={request.user_id} name={request.display_name} />
      <div className="d-row-body">
        <p className="d-label d-wrap"><StudentName name={request.display_name} /></p>
        <p className="d-meta"><bdi dir="auto">{label}</bdi> · <L id="ts.requests.asked" values={{ date: date(request.created_at) }} /></p>
      </div>
      {offering.manage && mode === 'idle' && <div className="d-actions d-request-actions">
        <Button type="button" variant="tertiary" data-reject onClick={() => setMode('reject')}><L id="ts.requests.reject" /></Button>
        <Button type="button" data-approve onClick={() => setMode('approve')}><L id="ts.requests.approve_into" /></Button>
      </div>}
    </div>
    {!offering.manage && <p className="d-meta"><L id="ts.requests.view_only" /></p>}
    {offering.manage && mode === 'approve' && <div data-approve-panel className="d-stack-sm">
      <label className="d-field"><span className="d-field-label"><L id="ts.requests.group_label" /></span>
        <Select data-approve-group value={groupId} onChange={setGroupId} disabled={busy} options={[{ value: '', label: <L id="ts.requests.no_group" /> }, ...choices.map(g => ({ value: g.id, label: g.name }))]} /></label>
      {groupsError && <p data-groups-unavailable className="d-body"><L id="ts.requests.groups_unavailable" /></p>}
      <div className="d-actions">
        <Button type="button" variant="primary" data-confirm-approve onClick={approve} disabled={busy}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.requests.approve" /></Button>
        <Button type="button" onClick={() => { setMode('idle'); }} disabled={busy}><L id="ts.requests.cancel" /></Button>
      </div>
    </div>}
    {offering.manage && mode === 'reject' && <div data-reject-panel className="d-stack-sm">
      <label className="d-field"><span className="d-field-label"><L id="ts.requests.reason" /></span>
        <input data-reject-reason className="d-field-input" value={reason} maxLength={1000} onChange={e => { setReason(e.target.value); setNeedReason(false); }} disabled={busy} aria-invalid={needReason} /></label>
      {needReason && <p role="alert" data-problem="reason" className="d-field-error"><L id="ts.requests.reason_required" /></p>}
      <div className="d-actions">
        <Button type="button" variant="destructive" data-confirm-reject onClick={reject} disabled={busy}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.requests.reject" /></Button>
        <Button type="button" onClick={() => { setMode('idle'); setNeedReason(false); }} disabled={busy}><L id="ts.requests.cancel" /></Button>
      </div>
    </div>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.kind === 'changed' ? onStale : mode === 'reject' ? reject : approve} retryLabel={error.kind === 'changed' ? 'tg.reload' : 'tg.retry'} pending={busy} />}
  </li>;
}

/** What happened to the last answers. "Approved, but not added" stays until the teacher closes it. */
function Notices({ notices, onClose }: { notices: Notice[]; onClose: (id: string) => void }) {
  const { t } = useLanguage();
  return <ul aria-live="polite" data-request-notices className="d-stack-sm">{notices.map(n => <li key={n.id} data-notice={n.outcome} className={`d-notice ${n.outcome === 'approved_not_added' ? 'd-notice--warning' : ''}`}>
    <p className="d-row-body d-stack-sm">
      <span className="d-label"><StudentName name={n.name} /></span>
      <span className="d-body">{n.outcome === 'rejected' ? <L id="ts.requests.rejected" />
        : n.outcome === 'approved_not_added' ? <L id="ts.requests.not_added" />
        : n.groupName ? <L id="ts.requests.approved_in" values={{ group: n.groupName }} /> : <L id="ts.requests.approved" />}</span>
      {n.outcome === 'approved_not_added' && n.groupId && <Link href={`/teacher/groups/${n.groupId}`} className="d-inline-link"><L id="ts.requests.open_group" /></Link>}
    </p>
    <Button type="button" variant="icon" data-dismiss-notice onClick={() => onClose(n.id)} aria-label={t('ts.requests.dismiss')}><Icon name="close" /></Button>
  </li>)}</ul>;
}

/** The Join requests section. It is there only while someone is waiting (or an answer needs to be read). */
export function RequestsSection({ rows, failed, more, labels, groups, groupsError, notices, onNotice, onCloseNotice, onChanged, onRetryFailed }: {
  rows: PendingRequest[]; failed: number; more: number; labels: Map<string, string>; groups: readonly StudyGroup[]; groupsError: boolean;
  notices: Notice[]; onNotice: (n: Notice) => void; onCloseNotice: (id: string) => void; onChanged: (id: string) => void; onRetryFailed: () => void;
}) {
  const phone = usePhone();
  const [opened, setOpened] = useState(false);
  if (!rows.length && !notices.length && !failed) return null;
  const showRows = rows.length > 0 && (!phone || opened);
  return <section aria-labelledby="ts-requests" data-join-requests data-tour="join-requests" className="d-banner d-stack">
    <h2 id="ts-requests" className="d-section-label"><L id="ts.requests.title" /></h2>
    {rows.length > 0 && !phone && <p className="d-label"><L id={rows.length === 1 ? 'ts.requests.waiting_one' : 'ts.requests.waiting'} values={{ count: rows.length }} /></p>}
    {rows.length > 0 && phone && <button type="button" data-requests-toggle aria-expanded={opened} onClick={() => setOpened(v => !v)} className="d-banner-toggle d-focus"><span className="d-label"><L id={rows.length === 1 ? 'ts.requests.waiting_one' : 'ts.requests.waiting'} values={{ count: rows.length }} /></span><Icon name="chevron" className={opened ? 'd-chevron d-rotate-90' : 'd-chevron'} /></button>}
    {notices.length > 0 && <Notices notices={notices} onClose={onCloseNotice} />}
    {failed > 0 && <div role="alert" data-state="error" className="d-alert"><p className="d-alert-text"><L id="ts.requests.load_failed" /></p><Button type="button" onClick={onRetryFailed}><L id="tg.retry" /></Button></div>}
    {showRows && <ul className="d-list d-stretch">{rows.map(item => <RequestItem key={item.request.id} item={item} groups={groups} groupsError={groupsError} label={labels.get(item.offering.id) ?? ''}
      onDone={() => onChanged(item.request.id)} onStale={onRetryFailed} onNotice={onNotice} />)}</ul>}
    {more > 0 && <p data-requests-more className="d-meta"><L id="ts.requests.more" /></p>}
  </section>;
}

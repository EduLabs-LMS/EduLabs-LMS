'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Select } from '@/frontend/components/design/controls';
import { inkButton, plainButton, primaryButton } from '@/frontend/features/teacher-home/parts';
import { GroupError, useCommand } from '@/frontend/features/teacher-groups/parts';
import type { StudyGroup } from '@/shared/contracts/groups';
import { approvalGroups, approveOutcome, type ApproveOutcome } from '@/shared/teacher-students';
import { adminCall, groupCall, newRequestId } from './api';
import type { PendingRequest } from './data';
import { StudentName, fieldClass, useDate } from './parts';

export type Notice = { id: string; outcome: ApproveOutcome | 'rejected'; name: string | null; groupId?: string; groupName?: string };
const tall = '!min-h-[48px]';

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

  return <li data-request={request.id} className="space-y-3 py-4">
    <div className="min-w-0">
      <p className="text-base font-bold"><StudentName name={request.display_name} /></p>
      <p className="text-base text-slate-700"><bdi dir="auto">{label}</bdi> · <L id="ts.requests.asked" values={{ date: date(request.created_at) }} /></p>
    </div>
    {!offering.manage && <p className="text-base text-slate-700"><L id="ts.requests.view_only" /></p>}
    {offering.manage && mode === 'idle' && <div className="flex flex-wrap gap-2">
      <button type="button" data-approve onClick={() => setMode('approve')} className={`${primaryButton} ${tall}`}><L id="ts.requests.approve" /></button>
      <button type="button" data-reject onClick={() => setMode('reject')} className={`${plainButton} ${tall}`}><L id="ts.requests.reject" /></button>
    </div>}
    {offering.manage && mode === 'approve' && <div data-approve-panel className="space-y-3">
      <label className="block space-y-1"><span className="font-bold"><L id="ts.requests.group_label" /></span>
        <Select data-approve-group value={groupId} onChange={setGroupId} disabled={busy} options={[{ value: '', label: <L id="ts.requests.no_group" /> }, ...choices.map(g => ({ value: g.id, label: g.name }))]} /></label>
      {groupsError && <p data-groups-unavailable className="text-base text-slate-800"><L id="ts.requests.groups_unavailable" /></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" data-confirm-approve onClick={approve} disabled={busy} className={`${inkButton} ${tall}`}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.requests.approve" /></button>
        <button type="button" onClick={() => { setMode('idle'); }} disabled={busy} className={`${plainButton} ${tall}`}><L id="ts.requests.cancel" /></button>
      </div>
    </div>}
    {offering.manage && mode === 'reject' && <div data-reject-panel className="space-y-3">
      <label className="block space-y-1"><span className="font-bold"><L id="ts.requests.reason" /></span>
        <input data-reject-reason className={fieldClass} value={reason} maxLength={1000} onChange={e => { setReason(e.target.value); setNeedReason(false); }} disabled={busy} aria-invalid={needReason} /></label>
      {needReason && <p role="alert" data-problem="reason" className="text-base font-bold text-rose-800"><L id="ts.requests.reason_required" /></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" data-confirm-reject onClick={reject} disabled={busy} className={`${inkButton} ${tall}`}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.requests.reject" /></button>
        <button type="button" onClick={() => { setMode('idle'); setNeedReason(false); }} disabled={busy} className={`${plainButton} ${tall}`}><L id="ts.requests.cancel" /></button>
      </div>
    </div>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.kind === 'changed' ? onStale : mode === 'reject' ? reject : approve} retryLabel={error.kind === 'changed' ? 'tg.reload' : 'tg.retry'} pending={busy} />}
  </li>;
}

/** What happened to the last answers. "Approved, but not added" stays until the teacher closes it. */
function Notices({ notices, onClose }: { notices: Notice[]; onClose: (id: string) => void }) {
  const { t } = useLanguage();
  return <ul aria-live="polite" data-request-notices className="space-y-2">{notices.map(n => <li key={n.id} data-notice={n.outcome} className={`flex items-start justify-between gap-3 rounded-xl border-2 border-black p-3 text-base ${n.outcome === 'approved_not_added' ? 'bg-amber-100' : 'bg-white'}`}>
    <p className="min-w-0 space-y-1">
      <span className="block font-bold"><StudentName name={n.name} /></span>
      <span className="block">{n.outcome === 'rejected' ? <L id="ts.requests.rejected" />
        : n.outcome === 'approved_not_added' ? <L id="ts.requests.not_added" />
        : n.groupName ? <L id="ts.requests.approved_in" values={{ group: n.groupName }} /> : <L id="ts.requests.approved" />}</span>
      {n.outcome === 'approved_not_added' && n.groupId && <Link href={`/teacher/groups/${n.groupId}`} className="inline-flex min-h-[48px] items-center font-bold underline underline-offset-4"><L id="ts.requests.open_group" /></Link>}
    </p>
    <button type="button" data-dismiss-notice onClick={() => onClose(n.id)} aria-label={t('ts.requests.dismiss')} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-white"><X aria-hidden className="h-5 w-5" /></button>
  </li>)}</ul>;
}

/** The Join requests section. It is there only while someone is waiting (or an answer needs to be read). */
export function RequestsSection({ rows, failed, more, labels, groups, groupsError, notices, onNotice, onCloseNotice, onChanged, onRetryFailed }: {
  rows: PendingRequest[]; failed: number; more: number; labels: Map<string, string>; groups: readonly StudyGroup[]; groupsError: boolean;
  notices: Notice[]; onNotice: (n: Notice) => void; onCloseNotice: (id: string) => void; onChanged: (id: string) => void; onRetryFailed: () => void;
}) {
  if (!rows.length && !notices.length && !failed) return null;
  return <section aria-labelledby="ts-requests" data-join-requests data-tour="join-requests" className="space-y-3">
    <div><h2 id="ts-requests" className="font-display text-2xl leading-tight"><L id="ts.requests.title" /></h2>{rows.length > 0 && <p className="text-base text-slate-700"><L id="ts.requests.intro" /></p>}</div>
    {notices.length > 0 && <Notices notices={notices} onClose={onCloseNotice} />}
    {failed > 0 && <div role="alert" data-state="error" className="space-y-3 rounded-2xl border-2 border-black bg-rose-50 p-4 text-base"><p><L id="ts.requests.load_failed" /></p><button type="button" onClick={onRetryFailed} className={plainButton}><L id="tg.retry" /></button></div>}
    {rows.length > 0 && <ul className="divide-y-2 divide-black/15 border-y-2 border-black/15">{rows.map(item => <RequestItem key={item.request.id} item={item} groups={groups} groupsError={groupsError} label={labels.get(item.offering.id) ?? item.offering.name}
      onDone={() => onChanged(item.request.id)} onStale={onRetryFailed} onNotice={onNotice} />)}</ul>}
    {more > 0 && <p data-requests-more className="text-base text-slate-700"><L id="ts.requests.more" /></p>}
  </section>;
}

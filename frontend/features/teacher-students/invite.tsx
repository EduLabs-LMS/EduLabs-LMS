'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import { useId, useState } from 'react';
import { Check, Copy, Loader2, Share2 } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Select } from '@/frontend/components/design/controls';
import Link from 'next/link';
import { inkButton, linkClass, plainButton, primaryButton } from '@/frontend/features/teacher-home/parts';
import { GroupError, useCommand } from '@/frontend/features/teacher-groups/parts';
import { postJson } from '@/frontend/features/teacher-groups/api';
import type { CourseChoice } from '@/shared/teacher-groups';
import { coursePagePath } from '@/shared/teacher-course-page';
import { DEFAULT_LINK_DAYS, LINK_DAYS, activeLinks, joinPath, linkExpiry, tokenFromBytes, type LinkRow } from '@/shared/teacher-students';
import { adminCall, newRequestId } from './api';
import { useLoaded } from './data';
import { fieldClass, useDate } from './parts';

const tall = '!min-h-[48px]';

/** The secret is made here, from the browser's random generator, shown once, and kept nowhere: not in storage, not in the address bar, not in a log. */
type Made = { url: string; expiresAt: string; course: string };

function ActiveLinks({ offeringId, onRevoked }: { offeringId: string; onRevoked: () => void }) {
  const date = useDate();
  const { data, retry } = useLoaded(() => adminCall<LinkRow[]>('links', { page: 0 }, { offeringId }));
  const [asking, setAsking] = useState<string | null>(null);
  const { busy, error, run } = useCommand(() => { setAsking(null); onRevoked(); });
  if (data.state === 'loading') return <p role="status" data-state="loading" className="text-base text-slate-700"><L id="tg.loading" /></p>;
  if (data.state === 'error') return <GroupError kind={data.error.kind} onRetry={retry} />;
  const rows = activeLinks(data.value, Date.now());
  return <div className="space-y-2" data-active-links>
    <h3 className="font-bold"><L id="ts.invite.active" /></h3>
    {rows.length === 0 && <p data-state="empty" className="text-base text-slate-700"><L id="ts.invite.active_none" /></p>}
    <ul className="divide-y-2 divide-black/15">{rows.map(l => <li key={l.id} data-link={l.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base"><L id="ts.invite.expires" values={{ date: date(l.expires_at) }} /></span>
        {asking !== l.id && <button type="button" data-revoke onClick={() => setAsking(l.id)} className={`${plainButton} ${tall}`}><L id="ts.invite.revoke" /></button>}
      </div>
      {asking === l.id && <div data-revoke-confirm className="space-y-2"><p className="text-base"><L id="ts.invite.revoke_confirm" /></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-confirm-revoke disabled={busy} onClick={() => void run(() => adminCall('revoke-link', { linkId: l.id }, { offeringId, requestId: newRequestId() }))} className={`${inkButton} ${tall}`}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.invite.revoke_yes" /></button>
          <button type="button" disabled={busy} onClick={() => setAsking(null)} className={`${plainButton} ${tall}`}><L id="ts.requests.cancel" /></button>
        </div></div>}
    </li>)}</ul>
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.kind === 'changed' ? retry : undefined} retryLabel="tg.reload" />}
  </div>;
}

export function InvitePanel({ courses, initialOffering, onClose }: { courses: CourseChoice[]; initialOffering: string | null; onClose: () => void }) {
  const id = useId();
  const { t } = useLanguage();
  const date = useDate();
  // Only a published course can be invited to: a student opening the link of a draft would be refused. Drafts are listed, disabled, with the way to publish them.
  const open = courses.filter(c => c.published), drafts = courses.filter(c => !c.published);
  const [courseId, setCourseId] = useState(() => (open.find(c => c.runId && c.runId === initialOffering) ?? open[0])?.courseId ?? '');
  const [days, setDays] = useState<number>(DEFAULT_LINK_DAYS);
  const [made, setMade] = useState<Made | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const [revision, setRevision] = useState(0);
  const [runs, setRuns] = useState<Record<string, string>>({});
  const choice = open.find(c => c.courseId === courseId);
  const runId = choice ? runs[choice.courseId] ?? choice.runId : null;
  const { busy, error, run } = useCommand(() => setRevision(v => v + 1));
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const create = () => {
    if (!choice || !choice.published) return; // never ask for a link to a draft course, whatever the screen shows
    setMade(null); setCopied(null);
    void run(async () => {
      const offeringId = runId ?? (await postJson<{ offeringId: string }>('/api/study-groups/course-run', { courseId: choice.courseId })).offeringId;
      setRuns(r => ({ ...r, [choice.courseId]: offeringId }));
      const token = tokenFromBytes(crypto.getRandomValues(new Uint8Array(32)));
      const expiresAt = linkExpiry(Date.now(), days);
      await adminCall('link', { token, kind: 'request', recipientId: null, expiresAt, enrollmentExpiresAt: null }, { offeringId, requestId: newRequestId() });
      setMade({ url: `${window.location.origin}${joinPath(token)}`, expiresAt, course: choice.title });
      actionToast(t('ts.invite.ready'));
    });
  };
  const copy = async () => {
    if (!made) return;
    try { await navigator.clipboard.writeText(made.url); setCopied('yes'); } catch { setCopied('failed'); }
  };
  const share = async () => {
    if (!made) return;
    try { await navigator.share({ title: t('ts.invite.share_title', { course: made.course }), text: t('ts.invite.share_text', { course: made.course }), url: made.url }); } catch { /* closing the share sheet is not an error */ }
  };
  const close = () => { setMade(null); onClose(); };

  return <section aria-labelledby={`${id}-t`} data-invite-panel data-tour="invite-panel" className="space-y-4 border-y-2 border-black/15 py-5">
    <div><h2 id={`${id}-t`} className="font-display text-2xl leading-tight"><L id="ts.invite.title" /></h2><p className="text-base text-slate-700"><L id="ts.invite.intro" /></p></div>
    {courses.length === 0 ? <p data-state="empty" className="text-base text-slate-800"><L id="ts.invite.no_courses" /></p> : <>
      {open.length === 0 && <p data-no-published className="text-base text-slate-800"><L id="ts.invite.none_published" /></p>}
      {open.length > 0 && <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1" htmlFor={`${id}-c`}><span className="font-bold"><L id="ts.invite.course" /></span>
          <Select id={`${id}-c`} data-invite-course value={courseId} onChange={v => { setCourseId(v); setMade(null); setCopied(null); }} options={[...open.map(c => ({ value: c.courseId, label: c.title })), ...drafts.map(c => ({ value: c.courseId, label: t('ts.invite.draft_option', { title: c.title }), disabled: true }))]} /></label>
        <label className="block space-y-1" htmlFor={`${id}-d`}><span className="font-bold"><L id="ts.invite.length" /></span>
          <Select id={`${id}-d`} data-invite-days value={String(days)} onChange={v => setDays(Number(v))} options={LINK_DAYS.map(d => ({ value: String(d), label: t(d === 1 ? 'ts.invite.day_one' : 'ts.invite.days', { count: d }) }))} /></label>
      </div>}
      {drafts.length > 0 && <ul data-draft-courses className="divide-y-2 divide-black/15 border-y-2 border-black/15">{drafts.map(c => <li key={c.courseId} data-draft-course={c.courseId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0"><span className="block break-words text-base font-bold"><bdi dir="auto">{c.title}</bdi></span><span className="block text-base text-slate-700"><L id="ts.invite.draft_line" /></span></span>
        <Link href={coursePagePath(c.courseId)} data-draft-link className={linkClass}><L id="ts.invite.draft_link" /></Link></li>)}</ul>}
      {open.length > 0 && <button type="button" data-create-link data-tour="create-link" onClick={create} disabled={busy || !choice} className={`${primaryButton} ${tall} w-full sm:w-auto`}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.invite.create" /></button>}
      {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} invalidText="ts.invite.invalid" onRetry={error.status === null ? undefined : create} pending={busy} />}
      {error?.status === null && <p data-link-unknown className="text-base text-slate-800"><L id="ts.invite.unknown" /></p>}
      {made && <div data-made-link role="status" className="space-y-3 rounded-xl border-2 border-black bg-primary/20 p-4">
        <p className="text-base font-bold"><L id="ts.invite.ready" /></p>
        <label className="block space-y-1" htmlFor={`${id}-u`}><span className="sr-only"><L id="ts.invite.link_label" /></span>
          <input id={`${id}-u`} data-join-link readOnly dir="ltr" autoComplete="off" spellCheck={false} value={made.url} onFocus={e => e.currentTarget.select()} className={`${fieldClass} font-mono`} /></label>
        <p className="text-base"><L id="ts.invite.expires" values={{ date: date(made.expiresAt) }} /></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-copy-link onClick={() => void copy()} className={`${inkButton} ${tall}`}>{copied === 'yes' ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}<L id={copied === 'yes' ? 'ts.invite.copied' : 'ts.invite.copy'} /></button>
          {canShare && <button type="button" data-share-link onClick={() => void share()} className={`${plainButton} ${tall}`}><Share2 aria-hidden className="h-4 w-4" /><L id="ts.invite.share" /></button>}
          <button type="button" data-done-link onClick={close} className={`${plainButton} ${tall}`}><L id="ts.invite.done" /></button>
        </div>
        {copied === 'failed' && <p role="alert" data-copy-failed className="text-base font-bold text-rose-800"><L id="ts.invite.copy_failed" /></p>}
      </div>}
      {runId && <ActiveLinks key={`${runId}:${revision}`} offeringId={runId} onRevoked={() => setRevision(v => v + 1)} />}
    </>}
    {!made && <button type="button" data-close-invite onClick={close} className={`${plainButton} ${tall}`}><L id="ts.invite.close" /></button>}
  </section>;
}

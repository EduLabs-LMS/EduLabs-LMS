'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import { useId, useState } from 'react';
import { Check, Copy, Loader2, Share2 } from 'lucide-react';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { PageHeader } from '@/frontend/components/design/page-header';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Select } from '@/frontend/components/design/controls';
import Link from 'next/link';
import { GroupError, useCommand } from '@/frontend/features/teacher-groups/parts';
import { postJson } from '@/frontend/features/teacher-groups/api';
import { failureKind, type CourseChoice } from '@/shared/teacher-groups';
import { coursePagePath } from '@/shared/teacher-course-page';
import { DEFAULT_LINK_DAYS, LINK_DAYS, activeLinks, joinPath, linkExpiry, tokenFromBytes, type LinkRow } from '@/shared/teacher-students';
import { adminCall, newRequestId } from './api';
import { useLoaded } from './data';
import { useDate } from './parts';

/** The secret is made here, from the browser's random generator, shown once, and kept nowhere: not in storage, not in the address bar, not in a log. */
type Made = { url: string; expiresAt: string; course: string };

function ActiveLinks({ offeringId, onRevoked }: { offeringId: string; onRevoked: () => void }) {
  const date = useDate();
  const { data, retry } = useLoaded(() => adminCall<LinkRow[]>('links', { page: 0 }, { offeringId }));
  const [asking, setAsking] = useState<string | null>(null);
  const { busy, error, run } = useCommand(() => { setAsking(null); onRevoked(); });
  if (data.state === 'loading') return <p role="status" data-state="loading" className="d-meta"><L id="tg.loading" /></p>;
  if (data.state === 'error') return <GroupError kind={data.error.kind} onRetry={retry} />;
  const rows = activeLinks(data.value, Date.now());
  return <div className="d-card d-card--pad d-stack-sm" data-active-links>
    <h2 className="d-section-label"><L id="ts.invite.active" /></h2>
    {rows.length === 0 && <p data-state="empty" className="d-meta"><L id="ts.invite.active_none" /></p>}
    <ul className="d-list">{rows.map(l => <li key={l.id} data-link={l.id} className="d-row d-row--stack">
      <div className="d-toolbar d-toolbar--full">
        <span className="d-body"><L id="ts.invite.expires" values={{ date: date(l.expires_at) }} /></span>
        {asking !== l.id && <Button type="button" data-revoke onClick={() => setAsking(l.id)}><L id="ts.invite.revoke" /></Button>}
      </div>
      {asking === l.id && <div data-revoke-confirm className="d-stack-sm"><p className="d-body"><L id="ts.invite.revoke_confirm" /></p>
        <div className="d-actions">
          <Button type="button" variant="destructive" data-confirm-revoke disabled={busy} onClick={() => void run(() => adminCall('revoke-link', { linkId: l.id }, { offeringId, requestId: newRequestId() }))}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.invite.revoke_yes" /></Button>
          <Button type="button" disabled={busy} onClick={() => setAsking(null)}><L id="ts.requests.cancel" /></Button>
        </div></div>}
    </li>)}</ul>
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.kind === 'changed' ? retry : undefined} retryLabel="tg.reload" />}
  </div>;
}

/** Invite students, on its own page: the course to preselect comes from the address, the link itself stays in this component's state and goes when the page is left. */
export function InvitePage({ courses, initialOffering }: { courses: { ok: true; value: CourseChoice[] } | { ok: false; status: number | null }; initialOffering: string | null }) {
  return <div data-teacher-invite className="d-page">
    <PageHeader back={{ href: '/teacher/students', label: <L id="ts.invite.back" />, data: { 'data-close-invite': '' } }} title={<L id="ts.invite.title" />} meta={<L id="ts.invite.intro" />} />
    {courses.ok ? <InvitePanel courses={courses.value} initialOffering={initialOffering} /> : <GroupError kind={failureKind(courses.status)} />}
  </div>;
}

function InvitePanel({ courses, initialOffering }: { courses: CourseChoice[]; initialOffering: string | null }) {
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

  return <section aria-label={t('ts.invite.title')} data-invite-panel data-tour="invite-panel" className="d-stack-lg">
    {courses.length === 0 ? <p data-state="empty" className="d-card d-card--pad d-body"><L id="ts.invite.no_courses" /></p> : <>
      {open.length === 0 && <p data-no-published className="d-body"><L id="ts.invite.none_published" /></p>}
      {open.length > 0 && <div className="d-card d-card--pad d-stack-lg"><div className="d-field-pair d-field-pair--wide">
        <label className="d-field" htmlFor={`${id}-c`}><span className="d-field-label"><L id="ts.invite.course" /></span>
          <Select id={`${id}-c`} data-invite-course value={courseId} onChange={v => { setCourseId(v); setMade(null); setCopied(null); }} options={[...open.map(c => ({ value: c.courseId, label: c.title })), ...drafts.map(c => ({ value: c.courseId, label: t('ts.invite.draft_option', { title: c.title }), disabled: true }))]} /></label>
        <label className="d-field" htmlFor={`${id}-d`}><span className="d-field-label"><L id="ts.invite.length" /></span>
          <Select id={`${id}-d`} data-invite-days value={String(days)} onChange={v => setDays(Number(v))} options={LINK_DAYS.map(d => ({ value: String(d), label: t(d === 1 ? 'ts.invite.day_one' : 'ts.invite.days', { count: d }) }))} /></label>
      </div>
      <Button type="button" variant="primary" data-create-link data-tour="create-link" onClick={create} disabled={busy || !choice}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.invite.create" /></Button></div>}
      {drafts.length > 0 && <ul data-draft-courses className="d-list d-card">{drafts.map(c => <li key={c.courseId} data-draft-course={c.courseId} className="d-row d-row--action">
        <span className="d-row-body"><span className="d-label d-wrap"><span><bdi dir="auto">{c.title}</bdi></span></span><span className="d-meta"><L id="ts.invite.draft_line" /></span></span>
        <span className="d-row-trailing"><Link href={coursePagePath(c.courseId)} data-draft-link className={buttonClass('secondary')}><L id="ts.invite.draft_link" /></Link></span></li>)}</ul>}
      {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} invalidText="ts.invite.invalid" onRetry={error.status === null ? undefined : create} pending={busy} />}
      {error?.status === null && <p data-link-unknown className="d-body"><L id="ts.invite.unknown" /></p>}
      {made && <div data-made-link role="status" className="d-banner d-stack-sm">
        <p className="d-label"><L id="ts.invite.ready" /></p>
        <label className="d-field" htmlFor={`${id}-u`}><span className="sr-only"><L id="ts.invite.link_label" /></span>
          <input id={`${id}-u`} data-join-link readOnly dir="ltr" autoComplete="off" spellCheck={false} value={made.url} onFocus={e => e.currentTarget.select()} className="d-field-input d-mono" /></label>
        <p className="d-body"><L id="ts.invite.expires" values={{ date: date(made.expiresAt) }} /></p>
        <div className="d-actions">
          <Button type="button" variant="primary" data-copy-link onClick={() => void copy()}>{copied === 'yes' ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}<L id={copied === 'yes' ? 'ts.invite.copied' : 'ts.invite.copy'} /></Button>
          {canShare && <Button type="button" data-share-link onClick={() => void share()}><Share2 aria-hidden className="h-4 w-4" /><L id="ts.invite.share" /></Button>}
          <Link href="/teacher/students" data-done-link onClick={() => setMade(null)} className={buttonClass('secondary')}><L id="ts.invite.done" /></Link>
        </div>
        {copied === 'failed' && <p role="alert" data-copy-failed className="d-field-error"><L id="ts.invite.copy_failed" /></p>}
      </div>}
      {runId && <ActiveLinks key={`${runId}:${revision}`} offeringId={runId} onRevoked={() => setRevision(v => v + 1)} />}
    </>}
  </section>;
}

'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ActionMenu, type MenuAction } from '@/frontend/components/design/action-menu';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Select } from '@/frontend/components/design/controls';
import { Dialog } from '@/frontend/components/design/dialog';
import { Icon } from '@/frontend/components/design/icon';
import { PageHeader } from '@/frontend/components/design/page-header';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { Tabs } from '@/frontend/components/design/tabs';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { actionToast } from '@/frontend/lib/action-toast';
import { SectionError } from '@/frontend/features/teacher-home/parts';
import type { MessageKey } from '@/frontend/locales/messages';
import { countForm } from '@/frontend/features/teacher-course/content-words';
import { cairoDay, cairoTime, pageCount } from '@/shared/teacher-homework';
import {
  dayLabel, EXAM_PORTAL_TABS, examRowActions, liveNow, timeLeft, toCorrect, unpublishBlocked,
  type ExamFailure, type ExamPageLoad, type ExamTab, type Portal, type PortalGroup, type PortalRow,
} from '@/shared/teacher-exams';
import { EXAMS_API, examCall, examCount, examFailureWords } from './exam-words';

const READ_EVERY = 60000;
type Popup = { type: 'archive'; row: PortalRow } | null;

/**
 * The teacher's Exams page: what is live now (each Group whose window is open, with how many started), what waits to be corrected (essays
 * waiting, paper marks missing), and every exam by Open, Closed, Drafts and Archived. Everything comes from exam_portal; each action goes
 * through the teacher Exams routes and the page reads again after it. Buttons follow what the teacher's own context suggests; the database decides.
 */
export function TeacherExamsPage({ load }: { load: ExamPageLoad }) {
  const { t, language, number } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const router = useLoadingRouter();
  const courses = useMemo(() => load.state === 'ready' ? load.courses : [], [load]);
  const [course, setCourse] = useState('');
  const [tab, setTab] = useState<ExamTab>('open');
  const [page, setPage] = useState(0);
  const [portal, setPortal] = useState<Portal | null>(null);
  // Live now and To correct come from the first page of Open and of Closed, read with the list.
  const [overview, setOverview] = useState<{ open: Portal; closed: Portal } | null>(null);
  const [failure, setFailure] = useState<{ status: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [popup, setPopup] = useState<Popup>(null);
  const [notice, setNotice] = useState<{ at: string; failure: ExamFailure } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const [tick, setTick] = useState(() => Date.now());
  const last = useRef(0), readAt = useRef(Date.now());

  const read = useCallback(async () => {
    const mine = ++last.current;
    setReading(true);
    const ask = async (which: ExamTab, at: number) => {
      const response = await fetch(`${EXAMS_API}?${new URLSearchParams({ tab: which, page: String(at), ...(course ? { course } : {}) })}`, { cache: 'no-store' });
      if (!response.ok) throw Object.assign(new Error('read'), { status: response.status });
      return await response.json() as Portal;
    };
    try {
      const [open, closed] = await Promise.all([ask('open', 0), ask('closed', 0)]);
      const list = tab === 'open' && page === 0 ? open : tab === 'closed' && page === 0 ? closed : await ask(tab, page);
      if (mine !== last.current) return;
      readAt.current = Date.now(); setTick(Date.now());
      setOverview({ open, closed }); setPortal(list); setFailure(null);
    } catch (e) { if (mine === last.current) setFailure({ status: (e as { status?: number }).status ?? null }); }
    finally { if (mine === last.current) setReading(false); }
  }, [course, page, tab]);
  useEffect(() => { void read(); }, [read]);
  // Live now moves: the counts are read again every minute, the time left counts down in between (from the server's seconds).
  useEffect(() => {
    const again = window.setInterval(() => { if (document.visibilityState === 'visible') void read(); }, READ_EVERY);
    const clock = window.setInterval(() => setTick(Date.now()), 15000);
    return () => { window.clearInterval(again); window.clearInterval(clock); };
  }, [read]);

  const courseById = useMemo(() => new Map(courses.map(c => [c.id, c])), [courses]);
  const canEdit = (row: PortalRow) => Boolean(courseById.get(row.courseId)?.canEdit);
  const editable = courses.filter(c => c.canEdit && c.offerings.length > 0);
  const newHref = `/teacher/exams/new${course && editable.some(c => c.id === course) ? `?course=${course}` : ''}`;
  const say = (text: string) => { setLive(text); actionToast(text); };

  /** Publish, unpublish, archive, duplicate: the revision is read first (the page read has none), then the change is sent with it. */
  async function lifecycle(row: PortalRow, action: 'publish' | 'unpublish' | 'archive' | 'clone') {
    if (busy) return false;
    setBusy(row.id); setNotice(null);
    try {
      const view = await examCall<{ revision: number }>(`${EXAMS_API}/${row.id}`);
      if (!view.ok) { setNotice({ at: row.id, failure: view.failure }); return false; }
      const done = await examCall<{ id: string }>(`${EXAMS_API}/${row.id}/lifecycle`, { action, revision: view.body.revision });
      if (!done.ok) { setNotice({ at: row.id, failure: done.failure }); return false; }
      if (action === 'clone') { say(t('ex.live.duplicated', { title: row.title })); router.push(`/teacher/exams/${done.body.id}`); return true; }
      say(t(action === 'publish' ? 'ex.live.published' : action === 'unpublish' ? 'ex.live.unpublished' : 'ex.live.archived', { title: row.title }));
      await read();
      return true;
    } finally { setBusy(null); }
  }

  const actionsOf = (row: PortalRow): MenuAction[] => examRowActions(row, canEdit(row)).map(key => {
    const data = { 'data-action': key };
    if (key === 'correct') return { key, label: t('ex.action.correct'), data, onSelect: () => router.push(`/teacher/exams/${row.id}/correct`) };
    if (key === 'marks') return { key, label: t('ex.action.marks'), data, onSelect: () => router.push(`/teacher/exams/${row.id}/marks`) };
    if (key === 'edit') return { key, label: t('ex.action.edit'), data, onSelect: () => router.push(`/teacher/exams/${row.id}`) };
    if (key === 'publish') return { key, label: t('ex.action.publish'), data, onSelect: () => void lifecycle(row, 'publish') };
    if (key === 'unpublish') { const blocked = unpublishBlocked(row); return { key, label: t('ex.action.unpublish'), data, unavailable: blocked, reason: blocked ? t('ex.fail.started') : undefined, onSelect: () => void lifecycle(row, 'unpublish') }; }
    if (key === 'archive') return { key, label: t('ex.action.archive'), data, onSelect: () => setPopup({ type: 'archive', row }) };
    return { key, label: t('ex.action.duplicate'), note: t('ex.action.duplicate_note'), data, onSelect: () => void lifecycle(row, 'clone') };
  });

  const elapsed = Math.max(0, Math.round((tick - readAt.current) / 1000));
  const liveCards = overview ? liveNow(overview.open.rows) : [];
  const correctCards = overview ? toCorrect([...overview.open.rows, ...overview.closed.rows]) : [];
  const nothing = portal && Object.values(portal.counts).every(n => n === 0);

  const filter = courses.length > 1 && <label className="d-field" data-course-filter>
    <span className="d-field-label"><L id="ex.filter" /></span>
    <Select value={course} onChange={v => { setCourse(v); setPage(0); }} options={[{ value: '', label: t('ex.all_courses') }, ...courses.map(c => ({ value: c.id, label: <bdi dir="auto">{c.title}</bdi> }))]} />
  </label>;

  return <div data-exams-page className="d-stack-lg">
    <PageHeader data-exams-header title={<L id="ex.title" />}
      primary={editable.length ? { key: 'new', label: <><Icon name="plus" size={18} /><L id="ex.new" /></>, href: newHref, data: { 'data-new-exam': '' } } : undefined} />
    {failure && <SectionError status={failure.status} onRetry={() => void read()} pending={reading} />}
    {!portal && !failure && <Loading />}

    {portal && liveCards.length > 0 && <section aria-labelledby="ex-live" data-live-now className="d-card d-card--pad d-stack-sm">
      <div className="d-hw-qhead"><span aria-hidden="true" className="d-live-dot" /><h2 id="ex-live" className="d-section"><L id="ex.live_now" /></h2></div>
      <ul className="d-list">{liveCards.map(c => {
        const left = c.secondsLeft === null ? null : timeLeft(Math.max(0, c.secondsLeft - elapsed));
        return <li key={`${c.examId}:${c.groupId}`} data-live-card={c.examId} data-live-group={c.groupId ?? 'none'} className="d-row d-row--action">
          <span className="d-row-body">
            <span className="d-label"><bdi dir="auto">{c.title}</bdi></span>
            <span className="d-meta"><bdi dir="auto">{c.name ?? t('ex.no_group')}</bdi> · <bdi dir="auto">{c.courseTitle}</bdi></span>
            <span className="d-meta d-bar-wrap" data-live-started={`${c.started}/${c.total}`}>
              <span className="d-bar" aria-hidden="true"><span className="d-bar-fill" style={{ width: `${c.total ? Math.min(100, Math.round(100 * c.started / c.total)) : 0}%` }} /></span>
              {t('ex.started_of', { n: number(c.started), total: number(c.total) })}
            </span>
          </span>
          <span className="d-row-trailing">
            {left && <StatusPill tone="info" data-time-left="">{left.hours ? t('ex.left_hm', { h: number(left.hours), m: number(left.minutes) }) : t('ex.left_m', { m: number(left.minutes) })}</StatusPill>}
          </span>
        </li>;
      })}</ul>
    </section>}

    {portal && !phone && filter}

    {portal && <section aria-labelledby="ex-correct" data-to-correct className="d-card d-card--pad d-stack-sm">
      <h2 id="ex-correct" className="d-section"><L id="ex.to_correct" /></h2>
      {correctCards.length === 0 ? <p data-state="empty" className="d-body"><L id="ex.to_correct_empty" /></p>
        : <ul className="d-list">{correctCards.map(c => <li key={c.examId} data-correct-row={c.examId} data-kind={c.kind} className="d-row d-row--action">
          <span className="d-row-body">
            <span className="d-label"><bdi dir="auto">{c.title}</bdi></span>
            <span className="d-meta"><bdi dir="auto">{c.courseTitle}</bdi></span>
          </span>
          <span className="d-row-trailing">
            <StatusPill tone="warning" data-waiting={c.waiting}>{c.kind === 'online' ? t(`ex.waiting.${countForm(c.waiting)}` as MessageKey, { n: number(c.waiting) }) : t('ex.entered_of', { n: number(c.entered), total: number(c.total) })}</StatusPill>
            <Link href={`/teacher/exams/${c.examId}/${c.kind === 'paper' ? 'marks' : 'correct'}`} className={buttonClass(phone ? 'secondary' : 'primary')} data-correct={c.examId}><L id={c.kind === 'paper' ? 'ex.enter_marks' : 'ex.correct'} /></Link>
          </span>
        </li>)}</ul>}
    </section>}

    {portal && nothing && <div data-state="empty" className="d-card d-card--pad d-stack-xs">
      <p className="d-label"><L id="ex.empty.title" /></p>
      <p className="d-body"><L id={editable.length ? 'ex.empty.body' : 'ex.empty.read_only'} /></p>
    </div>}

    {portal && !nothing && <section aria-labelledby="ex-list" data-exams-list className="d-card d-card--pad d-stack-sm">
      <h2 id="ex-list" className="d-section"><L id="ex.all" /></h2>
      {phone && filter}
      <Tabs label={t('ex.all')} active={tab} onSelect={key => { setTab(key as ExamTab); setPage(0); }} items={EXAM_PORTAL_TABS.map(key => ({ key, label: t(`ex.tab.${key}` as MessageKey, { n: number(portal.counts[key]) }), 'data-tab': key }))} />
      <div role="tabpanel" aria-busy={reading || undefined} data-tab-panel={tab}>
        {portal.tab === tab && portal.rows.length === 0 && <p data-state="empty" className="d-body d-homework-empty"><L id={`ex.empty.${tab}` as MessageKey} /></p>}
        {portal.tab === tab && portal.rows.length > 0 && <ul className="d-list">{portal.rows.map(row => examRow(row))}</ul>}
      </div>
      {portal.tab === tab && pageCount(portal.counts[tab], portal.pageSize) > 1 && <div data-pager className="d-pager">
        {page > 0 && <Button data-page-prev onClick={() => setPage(page - 1)}><L id="hw.prev" /></Button>}
        <span className="d-meta">{t('hw.page', { n: page + 1, total: pageCount(portal.counts[tab], portal.pageSize) })}</span>
        {page + 1 < pageCount(portal.counts[tab], portal.pageSize) && <Button data-page-next onClick={() => setPage(page + 1)}><L id="hw.next" /></Button>}
      </div>}
    </section>}
    <p role="status" data-exams-live className="sr-only">{live}</p>
    {popup?.type === 'archive' && <ArchiveDialog row={popup.row} onClose={() => setPopup(null)} onConfirm={async () => { const done = await lifecycle(popup.row, 'archive'); if (done) setPopup(null); return done; }} failure={notice?.at === popup.row.id ? notice.failure : null} />}
  </div>;

  function windowText(row: PortalRow) {
    if (row.kind === 'paper') return t('ex.on_paper', { n: number(row.handedIn ?? 0), total: number(row.total ?? 0) }) + (row.heldOn ? ` · ${dayLabel(row.heldOn, lang)}` : '');
    if (row.timing === 'same_time') return row.opensAt && row.closesAt ? t('ex.same_time_at', { day: cairoDay(row.opensAt, lang), from: cairoTime(row.opensAt, lang), to: cairoTime(row.closesAt, lang) }) : t('ex.no_time');
    return row.startingFrom ? t('ex.per_group_from', { day: dayLabel(row.startingFrom, lang) }) : t('ex.no_start');
  }
  function groupLine(g: PortalGroup) {
    const when = g.opensAt && g.closesAt && g.state === 'ok' ? `${cairoDay(g.opensAt, lang)} ${cairoTime(g.opensAt, lang)}–${cairoTime(g.closesAt, lang)}` : t(g.state === 'cancelled' ? 'ex.window.cancelled' : 'ex.window.needs_time');
    return <li key={g.groupId} data-group-window={g.groupId} data-window={g.window} className="d-meta">
      <bdi dir="auto">{g.name}</bdi> · {when}{g.window === 'open' && <> · {t('ex.started_of', { n: number(g.started), total: number(g.total) })}</>}
    </li>;
  }
  function examRow(row: PortalRow) {
    const actions = actionsOf(row), rowNotice = notice?.at === row.id && popup === null ? notice.failure : null;
    return <li key={row.id} data-exam-row={row.id} data-status={row.status} data-kind={row.kind} className="d-row d-row--action d-homework-row">
      <span className="d-row-body d-stack-xs">
        <span className="d-label"><bdi dir="auto">{row.title}</bdi>{row.version > 1 && <span className="d-meta"> · {t('ex.version', { n: number(row.version) })}</span>}</span>
        <span className="d-meta"><bdi dir="auto">{row.courseTitle}</bdi>{row.kind === 'online' && <> · {examCount(t, 'question', row.questionCount)} · {examCount(t, 'mark', row.totalMarks)}</>}{row.kind === 'paper' && <> · {t('ex.out_of', { n: number(row.totalMarks) })}</>}</span>
        <span className="d-meta" data-when>{windowText(row)}{row.kind === 'online' && row.timeLimitMinutes ? ` · ${t('ex.limit_short', { n: number(row.timeLimitMinutes) })}` : ''}</span>
        {row.groups && row.groups.length > 0 && <ul className="d-stack-xs" data-group-windows>{row.groups.map(groupLine)}</ul>}
        {rowNotice && <span role="alert" data-row-failure={rowNotice.kind} className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" />{examFailureWords(t, rowNotice)}</span>}
      </span>
      <span className="d-row-trailing">
        {row.status === 'draft' && <StatusPill tone="neutral" data-draft=""><L id="ex.draft" /></StatusPill>}
        {row.held && <StatusPill tone="warning" data-held=""><L id="ex.held" /></StatusPill>}
        {row.status === 'published' && row.kind === 'online' && row.total !== null && <span className="d-meta" data-handed>{t('ex.handed_short', { n: number(row.handedIn ?? 0), total: number(row.total) })}</span>}
        {busy === row.id && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {actions.length > 0 && <ActionMenu label={t('ex.actions_for', { title: row.title })} triggerData={{ 'data-row-menu': row.id }} items={actions} />}
      </span>
    </li>;
  }
}

/** Archive: read only from then on; students keep the marks they were given. A calm confirm, the row says what failed if it does. */
function ArchiveDialog({ row, onClose, onConfirm, failure }: { row: PortalRow; onClose: () => void; onConfirm: () => Promise<boolean>; failure: ExamFailure | null }) {
  const { t } = useLanguage();
  const [sending, setSending] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open && !sending) onClose(); }} data-archive-dialog="" title={t('ex.archive.title')} description={<bdi dir="auto">{row.title}</bdi>}
    footer={<><Button data-archive-cancel aria-disabled={sending || undefined} onClick={() => { if (!sending) onClose(); }}><L id="hw.cancel" /></Button>
      <Button variant="primary" data-archive-confirm aria-disabled={sending || undefined} aria-busy={sending || undefined} onClick={async () => { if (sending) return; setSending(true); try { await onConfirm(); } finally { setSending(false); } }}>{sending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ex.archive.confirm" /></Button></>}>
    <p className="d-content-line"><Icon name="info" /><span><L id="ex.archive.body" /></span></p>
    {failure && <p role="alert" data-archive-error className="d-field-error">{examFailureWords(t, failure)}</p>}
  </Dialog>;
}

function Loading() {
  return <div role="status" data-state="loading" className="d-stack-lg">
    <div aria-hidden="true" className="d-card d-card--pad d-stack-sm">{[0, 1].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}</div>
    <div aria-hidden="true" className="d-card d-card--pad d-stack-sm">{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}</div>
    <span className="sr-only"><L id="th.state.loading" /></span>
  </div>;
}

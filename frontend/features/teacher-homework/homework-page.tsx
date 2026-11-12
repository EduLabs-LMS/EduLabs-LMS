'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ActionMenu, type MenuAction } from '@/frontend/components/design/action-menu';
import Link from 'next/link';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { IconBadge } from '@/frontend/components/design/card';
import { Select, Switch } from '@/frontend/components/design/controls';
import { Dialog } from '@/frontend/components/design/dialog';
import { Field } from '@/frontend/components/design/field';
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
import { cairoDay, cairoFields, cairoIso, cairoTime, cairoToday, deadlineInFuture, pageCount, PORTAL_TABS, rowActions, storageSize, weekRange, type HomeworkFailure, type HomeworkPageLoad, type Portal, type PortalRow, type PortalTab } from '@/shared/teacher-homework';
import { countText, failureWords, homeworkCall, triesText } from './homework-words';

type Popup = { type: 'deadline'; row: PortalRow } | { type: 'delete'; row: PortalRow };
const API = '/api/teacher/homework';

/**
 * The teacher's Homework page: this week's numbers, the essays waiting, and every homework by Open, Closed and Drafts. Everything comes from
 * homework_portal; each action goes through the teacher Homework routes, and the page reads again after it. Buttons follow what the teacher's
 * own context suggests; the database decides.
 */
export function TeacherHomeworkPage({ load }: { load: HomeworkPageLoad }) {
  const { t, language } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const router = useLoadingRouter();
  const courses = useMemo(() => load.state === 'ready' ? load.courses : [], [load]);
  const [course, setCourse] = useState('');
  const [tab, setTab] = useState<PortalTab>('open');
  const [page, setPage] = useState(0);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [failure, setFailure] = useState<{ status: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [notice, setNotice] = useState<{ at: string; failure: HomeworkFailure } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const last = useRef(0);

  const read = useCallback(async () => {
    const mine = ++last.current;
    setReading(true);
    const query = new URLSearchParams({ tab, page: String(page), ...(course ? { course } : {}) });
    try {
      const response = await fetch(`${API}?${query}`, { cache: 'no-store' });
      if (mine !== last.current) return;
      if (!response.ok) { setFailure({ status: response.status }); return; }
      setPortal(await response.json() as Portal); setFailure(null);
    } catch { if (mine === last.current) setFailure({ status: null }); }
    finally { if (mine === last.current) setReading(false); }
  }, [course, page, tab]);
  useEffect(() => { void read(); }, [read]);

  const courseById = useMemo(() => new Map(courses.map(c => [c.id, c])), [courses]);
  const canEdit = (row: PortalRow) => Boolean(courseById.get(row.courseId)?.canEdit);
  const canManage = (row: PortalRow) => Boolean(courseById.get(row.courseId)?.offerings.find(o => o.id === row.offeringId)?.canManage);
  const editable = courses.filter(c => c.canEdit && c.offerings.length > 0);
  const newHref = `/teacher/homework/new${course && editable.some(c => c.id === course) ? `?course=${course}` : ''}`;
  const say = (text: string) => { setLive(text); actionToast(text); };

  /** Publish or unpublish: the revision is read first (the page read has no revision), then the change is sent with it. */
  async function lifecycle(row: PortalRow, action: 'publish' | 'unpublish') {
    if (busy) return;
    setBusy(row.id); setNotice(null);
    try {
      const view = await homeworkCall<{ revision: number }>(`${API}/${row.id}`);
      if (!view.ok) { setNotice({ at: row.id, failure: view.failure }); return; }
      const done = await homeworkCall<{ id: string }>(`${API}/${row.id}/lifecycle`, { action, revision: view.body.revision });
      if (!done.ok) { setNotice({ at: row.id, failure: done.failure }); return; }
      say(t(action === 'publish' ? 'hw.live.published' : 'hw.live.unpublished', { title: row.title }));
      await read();
    } finally { setBusy(null); }
  }

  const actionsOf = (row: PortalRow, rowTab: PortalTab): MenuAction[] => rowActions(row, rowTab, canEdit(row), canManage(row)).map(key => {
    const data = { 'data-action': key };
    if (key === 'edit') return { key, label: t('hw.action.edit'), data, onSelect: () => router.push(`/teacher/homework/${row.id}`) };
    if (key === 'deadline') return { key, label: t('hw.action.deadline'), data, onSelect: () => setPopup({ type: 'deadline', row }) };
    if (key === 'publish' || key === 'unpublish') return { key, label: t(key === 'publish' ? 'hw.action.publish' : 'hw.action.unpublish'), data, onSelect: () => void lifecycle(row, key) };
    const size = storageSize(row.imageBytes ?? 0, n => String(n));
    return { key, label: t('hw.action.delete_images'), destructive: true, data, unavailable: !row.imageBytes, note: row.imageBytes ? t('hw.images', { size: t(size.unit === 'mb' ? 'hw.size.mb' : 'hw.size.kb', { n: size.value }) }) : t('hw.delete.none'), onSelect: () => setPopup({ type: 'delete', row }) };
  });

  const stats = portal?.stats;
  const week = stats ? weekRange(stats.weekStart, stats.weekEnd, lang) : null;
  const nothing = portal && !portal.toCorrect.length && !portal.counts.open && !portal.counts.closed && !portal.counts.drafts;
  const showList = !phone || listOpen;

  const header = <PageHeader data-homework-header title={listOpen && phone ? <L id="hw.all" /> : <L id="hw.title" />}
    meta={week ? t('hw.week', { from: week.from, to: week.to }) : undefined}
    primary={editable.length ? { key: 'new', label: <><Icon name="plus" size={18} /><L id="hw.new" /></>, href: newHref, data: { 'data-new-homework': '' } } : undefined} />;

  const filter = courses.length > 1 && <label className="d-field" data-course-filter>
    <span className="d-field-label"><L id="hw.filter" /></span>
    <Select value={course} onChange={v => { setCourse(v); setPage(0); }} options={[{ value: '', label: t('hw.all_courses') }, ...courses.map(c => ({ value: c.id, label: <bdi dir="auto">{c.title}</bdi> }))]} />
  </label>;

  return <div data-homework-page className="d-stack-lg">
    {phone && listOpen && <Button variant="tertiary" data-homework-back className="d-self-start" onClick={() => setListOpen(false)}><Icon name="back" size={16} /><L id="hw.title" /></Button>}
    {header}
    {failure && <SectionError status={failure.status} onRetry={() => void read()} pending={reading} />}
    {!portal && !failure && <Loading phone={phone} />}

    {portal && !listOpen && <>
      <div data-homework-stats className="d-tiles" style={{ '--d-tile-count': phone ? 2 : 4 } as React.CSSProperties}>
        <Stat name="waiting" value={stats!.essaysWaiting} label={phone ? 'hw.stat.waiting_short' : 'hw.stat.waiting'} tone="warning" icon="homework" />
        <Stat name="corrected" value={stats!.correctedThisWeek} label={phone ? 'hw.stat.corrected_short' : 'hw.stat.corrected'} tone="success" icon="check" />
        <Stat name="handed" value={stats!.handedInThisWeek} label={phone ? 'hw.stat.handed_short' : 'hw.stat.handed'} tone="info" icon="students" />
        <Stat name="on_time" value={stats!.onTimePercent} percent label={phone ? 'hw.stat.on_time_short' : 'hw.stat.on_time'} tone="neutral" icon="clock" />
      </div>
      {!phone && filter}
      {toCorrect(portal.toCorrect, phone)}
    </>}

    {portal && nothing && !listOpen && <div data-state="empty" className="d-card d-card--pad d-stack-xs">
      <p className="d-label"><L id="hw.empty.title" /></p>
      <p className="d-body"><L id={editable.length ? 'hw.empty.body' : 'hw.empty.read_only'} /></p>
    </div>}

    {portal && phone && !listOpen && !nothing && <button type="button" data-all-homework className="d-card d-row-link d-focus d-homework-all" onClick={() => setListOpen(true)}>
      <span className="d-row-body"><span className="d-label"><L id="hw.all" /></span>
        <span className="d-meta">{t('hw.all_meta', { open: portal.counts.open, closed: portal.counts.closed, drafts: portal.counts.drafts })}</span></span>
      <Icon name="chevron" size={18} />
    </button>}

    {portal && showList && !(nothing && !listOpen) && <section aria-labelledby="hw-list" data-homework-list className="d-card d-card--pad d-stack-sm">
      <h2 id="hw-list" className="sr-only"><L id="hw.all" /></h2>
      {phone && filter}
      <Tabs label={t('hw.all')} active={tab} onSelect={key => { setTab(key as PortalTab); setPage(0); }} items={PORTAL_TABS.map(key => ({ key, label: t(`hw.tab.${key}`, { n: portal.counts[key] }), 'data-tab': key }))} />
      <div role="tabpanel" aria-busy={reading || undefined} data-tab-panel={tab}>
        {portal.tab === tab && portal.rows.length === 0 && <p data-state="empty" className="d-body d-homework-empty"><L id={`hw.empty.${tab}`} /></p>}
        {portal.tab === tab && portal.rows.length > 0 && <ul className="d-list">{portal.rows.map(row => homeworkRow(row, tab, actionsOf(row, tab), busy === row.id, notice?.at === row.id ? notice.failure : null))}</ul>}
      </div>
      {portal.tab === tab && pageCount(portal.counts[tab], portal.pageSize) > 1 && <div data-pager className="d-pager">
        {page > 0 && <Button data-page-prev onClick={() => setPage(page - 1)}><L id="hw.prev" /></Button>}
        <span className="d-meta">{t('hw.page', { n: page + 1, total: pageCount(portal.counts[tab], portal.pageSize) })}</span>
        {page + 1 < pageCount(portal.counts[tab], portal.pageSize) && <Button data-page-next onClick={() => setPage(page + 1)}><L id="hw.next" /></Button>}
      </div>}
    </section>}
    <p role="status" data-homework-live className="sr-only">{live}</p>
    {popup?.type === 'deadline' && <DeadlineDialog row={popup.row} now={Date.parse(portal?.serverNow ?? '') || Date.now()} onClose={() => setPopup(null)} onDone={() => { say(t('hw.live.deadline', { title: popup.row.title })); setPopup(null); void read(); }} />}
    {popup?.type === 'delete' && <DeleteImagesDialog row={popup.row} onClose={() => setPopup(null)} onDone={text => { say(text); setPopup(null); void read(); }} />}
  </div>;

  function toCorrect(rows: PortalRow[], small: boolean) {
    return <section aria-labelledby="hw-correct" data-to-correct className="d-card d-card--pad d-stack-sm">
      <div className="d-stack-xs">
        <h2 id="hw-correct" className="d-section"><L id="hw.to_correct" /></h2>
        <p className="d-meta"><L id="hw.to_correct_note" /></p>
      </div>
      {rows.length === 0 ? <p data-state="empty" className="d-body"><L id="hw.to_correct_empty" /></p>
        : <ul className="d-list">{rows.map(row => <li key={row.id} data-correct-row={row.id} className="d-row d-row--action">
          <span className="d-row-body">
            <span className="d-label"><bdi dir="auto">{row.title}</bdi></span>
            <span className="d-meta"><bdi dir="auto">{row.courseTitle}</bdi> · <bdi dir="auto">{row.lessonTitle}</bdi>{row.deadline && <> · {t(Date.parse(row.deadline) <= Date.parse(portal!.serverNow) ? 'hw.closed_on' : 'hw.due_short', { day: cairoDay(row.deadline, lang) })}</>}</span>
            {!small && row.total !== null && <span className="d-meta d-bar-wrap">
              <span className="d-bar" aria-hidden="true"><span className="d-bar-fill" style={{ width: `${row.total ? Math.min(100, Math.round(100 * (row.handedIn ?? 0) / row.total)) : 0}%` }} /></span>
              {t('hw.handed', { handed: row.handedIn ?? 0, total: row.total })}{row.late ? ` · ${t('hw.late', { n: row.late })}` : ''}
            </span>}
          </span>
          <span className="d-row-trailing">
            <StatusPill tone="warning" data-waiting={row.waiting ?? 0}>{t('hw.waiting', { n: row.waiting ?? 0 })}</StatusPill>
            <Link href={`/teacher/homework/${row.id}/correct`} className={buttonClass(small ? 'secondary' : 'primary')} data-correct={row.id}><L id="hw.correct" /></Link>
          </span>
        </li>)}</ul>}
    </section>;
  }

  function homeworkRow(row: PortalRow, rowTab: PortalTab, actions: MenuAction[], rowBusy: boolean, rowNotice: HomeworkFailure | null) {
    const size = row.imageBytes !== null ? storageSize(row.imageBytes, n => String(n)) : null;
    return <li key={row.id} data-homework-row={row.id} data-status={row.status} className="d-row d-row--action d-homework-row">
      <span className="d-row-body d-stack-xs">
        <span className="d-label"><bdi dir="auto">{row.title}</bdi>{row.version > 1 && <span className="d-meta"> · {t('hw.version', { n: row.version })}</span>}</span>
        <span className="d-meta"><bdi dir="auto">{row.courseTitle}</bdi> · <bdi dir="auto">{row.lessonTitle}</bdi></span>
        {row.workflow === 'questions' && <span className="d-meta" data-counts>{countText(t, 'question', row.questionCount)} · {countText(t, 'mark', row.totalMarks)}</span>}
        {row.workflow === 'questions' && <span className="d-meta" data-rules>
          {row.deadline ? t('hw.due', { day: cairoDay(row.deadline, lang), time: cairoTime(row.deadline, lang) }) : t('hw.no_deadline')}
          {row.lateAllowed && <> · {t('hw.late_allowed')}</>} · {triesText(t, row.tries, row.maxTries)} · {t(row.solutionsOpen === 'after_deadline' ? 'hw.solutions.after_deadline' : 'hw.solutions.after_hand_in')}
        </span>}
        {rowTab === 'closed' && size && <span className="d-meta" data-image-space>{t('hw.images', { size: t(size.unit === 'mb' ? 'hw.size.mb' : 'hw.size.kb', { n: size.value }) })}</span>}
        {rowNotice && <span role="alert" data-row-failure={rowNotice.kind} className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" />{failureWords(t, rowNotice)}</span>}
      </span>
      <span className="d-row-trailing">
        {row.status === 'draft' && <StatusPill tone="neutral" data-draft=""><L id="hw.draft" /></StatusPill>}
        {row.handedIn !== null && row.total !== null && row.status !== 'draft' && <span className="d-meta" data-handed>{t('hw.handed_short', { handed: row.handedIn, total: row.total })}</span>}
        {rowBusy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {actions.length > 0 && <ActionMenu label={t('hw.actions_for', { title: row.title })} triggerData={{ 'data-row-menu': row.id }} items={actions} />}
      </span>
    </li>;
  }
}

function Stat({ name, value, label, tone, icon, percent = false }: { name: string; value: number | null; label: 'hw.stat.waiting' | 'hw.stat.waiting_short' | 'hw.stat.corrected' | 'hw.stat.corrected_short' | 'hw.stat.handed' | 'hw.stat.handed_short' | 'hw.stat.on_time' | 'hw.stat.on_time_short'; tone: 'warning' | 'success' | 'info' | 'neutral'; icon: 'homework' | 'check' | 'students' | 'clock'; percent?: boolean }) {
  const { number } = useLanguage();
  return <div data-stat={name} className="d-card d-kpi"><IconBadge name={icon} tone={tone} /><span className="min-w-0">
    <span className="d-kpi-value">{value === null ? '–' : percent ? `${number(value)}%` : number(value)}</span>
    <span className="d-meta"><L id={label} /></span>
  </span></div>;
}

function Loading({ phone }: { phone: boolean }) {
  return <div role="status" data-state="loading" className="d-stack-lg">
    <div aria-hidden="true" className="d-tiles" style={{ '--d-tile-count': phone ? 2 : 4 } as React.CSSProperties}>{[0, 1, 2, 3].map(i => <div key={i} className="d-card d-kpi"><DesignSkeleton className="h-9 w-9" /><DesignSkeleton className="h-9 w-20" /></div>)}</div>
    <div aria-hidden="true" className="d-card d-card--pad d-stack-sm">{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}</div>
    <span className="sr-only"><L id="th.state.loading" /></span>
  </div>;
}

/** Change deadline: a new Cairo date and time in the future and "Allow after the deadline". No new version; students who already saw the solutions keep them. */
export function DeadlineDialog({ row, now, onClose, onDone }: { row: PortalRow; now: number; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const start = row.deadline && Date.parse(row.deadline) > now ? cairoFields(row.deadline) : { date: '', time: '23:59' };
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [late, setLate] = useState(row.lateAllowed);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function save() {
    if (sending) return;
    const iso = date ? cairoIso(date, time) : null;
    if (!iso) { setError(t(date ? 'hw.w.issue.deadline_invalid' : 'hw.w.issue.deadline')); return; }
    if (!deadlineInFuture(iso, Date.now())) { setError(t('hw.deadline.future')); return; }
    setSending(true); setError(null);
    try {
      const view = await homeworkCall<{ revision: number }>(`${API}/${row.id}`);
      if (!view.ok) { setError(failureWords(t, view.failure)); return; }
      const done = await homeworkCall<{ id: string }>(`${API}/${row.id}/lifecycle`, { action: 'reschedule', revision: view.body.revision, deadline: iso, lateAllowed: late });
      if (!done.ok) { setError(failureWords(t, done.failure)); return; }
      onDone();
    } finally { setSending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending) onClose(); }} data-deadline-dialog="" title={t('hw.deadline.title')} description={<bdi dir="auto">{row.title}</bdi>}
    footer={<><Button data-deadline-cancel aria-disabled={sending || undefined} onClick={() => { if (!sending) onClose(); }}><L id="hw.cancel" /></Button>
      <Button variant="primary" data-deadline-save aria-disabled={sending || undefined} aria-busy={sending || undefined} onClick={() => void save()}>{sending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="hw.deadline.save" /></Button></>}>
    <div className="d-stack-sm">
      <div className="d-field-pair">
        <Field type="date" label={<L id="hw.deadline.date" />} value={date} min={cairoToday(now)} onChange={e => { setDate(e.target.value); setError(null); }} data-deadline-date="" />
        <Field type="time" label={<L id="hw.deadline.time" />} value={time} onChange={e => { setTime(e.target.value); setError(null); }} data-deadline-time="" />
      </div>
      <Switch checked={late} onChange={setLate} label={<span className="d-stack-xs"><span><L id="hw.w.late" /></span><span className="d-meta"><L id="hw.w.late_hint" /></span></span>} data-deadline-late="" />
      <p className="d-content-line" data-deadline-note><Icon name="info" /><span><L id="hw.deadline.note" /></span></p>
      {error && <p role="alert" data-deadline-error className="d-field-error">{error}</p>}
    </div>
  </Dialog>;
}

/** Delete images of a closed homework: what it frees, and that grades and notes stay. */
function DeleteImagesDialog({ row, onClose, onDone }: { row: PortalRow; onClose: () => void; onDone: (text: string) => void }) {
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sizeText = (bytes: number) => { const s = storageSize(bytes, n => String(n)); return t(s.unit === 'mb' ? 'hw.size.mb' : 'hw.size.kb', { n: s.value }); };
  async function remove() {
    if (sending) return;
    setSending(true); setError(null);
    try {
      const done = await homeworkCall<{ deletedFiles: number; bytesFreed: number; storage: 'done' | 'retry' }>(`${API}/${row.id}/delete-images`, { confirm: true });
      if (!done.ok) { setError(failureWords(t, done.failure)); return; }
      onDone(t(done.body.storage === 'retry' ? 'hw.live.images_retry' : 'hw.live.images', { n: done.body.deletedFiles, size: sizeText(done.body.bytesFreed) }));
    } finally { setSending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending) onClose(); }} data-delete-images="" title={t('hw.delete.title')}
    description={t('hw.delete.body', { size: sizeText(row.imageBytes ?? 0), title: row.title })}
    footer={<><Button data-delete-cancel aria-disabled={sending || undefined} onClick={() => { if (!sending) onClose(); }}><L id="hw.cancel" /></Button>
      <Button variant="destructive" data-delete-confirm aria-disabled={sending || undefined} aria-busy={sending || undefined} onClick={() => void remove()}>{sending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="hw.delete.confirm" /></Button></>}>
    <p className="d-content-line"><Icon name="info" /><span><L id="hw.delete.kept" /></span></p>
    {error && <p role="alert" data-delete-error className="d-field-error">{error}</p>}
  </Dialog>;
}


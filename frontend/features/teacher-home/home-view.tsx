'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Countdown } from '@/frontend/components/design/countdown';
import { Button, Card, CardHead, DateTile, Icon, IconBadge, ListRow, PageHeader, StatusPill, buttonClass } from '@/frontend/components/design';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { useApplicationAuth, useWebsiteNavigation } from '@/frontend/components/providers/application-auth-provider';
import { eventLabels } from '@/shared/contracts/communications';
import { cairoHour, greetingKey, sessionsTodayKey, type HomeSession, type HomeUnsaved, type TeacherHomeLoad } from '@/shared/teacher-home';
import { attendanceHref } from '@/shared/teacher-attendance';
import { useCountUp } from '@/frontend/lib/page-entry';
import { useServerNow } from './use-server-now';
import { CreateCourse } from './create-course';
import { SectionError, sessionTime, useRetry } from './parts';

type HomeData = TeacherHomeLoad;
type Retry = ReturnType<typeof useRetry>;

const zone = { timeZone: 'Africa/Cairo' } as const;
const clock: Intl.DateTimeFormatOptions = { ...zone, hour: 'numeric', minute: '2-digit' };
const dayAndTime: Intl.DateTimeFormatOptions = { ...zone, weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
const shortDayAndTime: Intl.DateTimeFormatOptions = { ...zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

/** Nothing to show: said plainly, once. */
function Quiet({ id }: { id: 'th.next.empty' | 'th.first.next' | 'th.updates.empty' | 'th.coming.empty' }) {
  return <p data-state="empty" className="d-body pb-3"><L id={id} /></p>;
}

function Greeting({ now }: { now: string }) {
  const { user } = useApplicationAuth();
  const navigation = useWebsiteNavigation();
  const name = (user?.firstName || user?.fullName || navigation?.viewer.displayName || '').trim();
  const key = greetingKey(cairoHour(Date.parse(now)));
  return name ? <L id={`th.greet.${key}`} values={{ name }} /> : <L id={`th.greet.${key}_plain`} />;
}

function HomeMeta({ now, today }: { now: string; today: number | null }) {
  const { number } = useLanguage();
  return <>
    <LocalDate value={now} options={{ ...zone, weekday: 'long', day: 'numeric', month: 'long' }} />
    {today !== null && <span data-sessions-today> · <L id={sessionsTodayKey(today)} values={{ count: number(today) }} /></span>}
  </>;
}

/** One small number with its icon. A tile whose number is not known is left out, never guessed. */
function Tile({ name, value, label, tone }: { name: 'groups' | 'students'; value: number; label: 'th.summary.groups' | 'th.summary.students'; tone: 'success' | 'info' }) {
  const { number } = useLanguage();
  const shown = useCountUp(value);
  return <div data-summary={name} className="d-card d-kpi"><IconBadge name={name} tone={tone} /><span className="min-w-0"><span className="d-kpi-value">{number(shown)}</span><span className="d-meta"><L id={label} /></span></span></div>;
}

function Summary({ data }: { data: HomeData['summary'] }) {
  const count = (data.activeGroups !== null ? 1 : 0) + (data.students !== null ? 1 : 0);
  if (!count) return null;
  return <div data-home-summary className="d-tiles" style={{ '--d-tile-count': count } as React.CSSProperties}>
    {data.activeGroups !== null && <Tile name="groups" tone="success" value={data.activeGroups} label="th.summary.groups" />}
    {data.students !== null && <Tile name="students" tone="info" value={data.students} label="th.summary.students" />}
  </div>;
}

/** marked / total around the hero's headline. The sentence is for screen readers; the numbers are the picture. */
function Ring({ marked, total }: { marked: number; total: number }) {
  const { t, number } = useLanguage();
  const radius = 23, around = 2 * Math.PI * radius, done = total ? Math.min(marked / total, 1) : 0;
  return <span role="img" aria-label={t('th.next.ring', { marked: number(marked), total: number(total) })} data-progress-ring className="d-ring">
    <svg aria-hidden viewBox="0 0 56 56" fill="none"><circle className="d-ring-center" cx="28" cy="28" r={radius} /><circle className="d-ring-track" cx="28" cy="28" r={radius} strokeWidth="6" /><circle className="d-ring-fill" cx="28" cy="28" r={radius} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${around * done} ${around}`} /></svg>
    <span aria-hidden className="d-ring-text"><bdi dir="ltr">{number(marked)}/{number(total)}</bdi></span>
  </span>;
}

function Facts({ next, facts }: { next: HomeSession; facts: HomeData['nextFacts'] }) {
  const { number } = useLanguage();
  const students = facts?.kind === 'marked' ? facts.total : facts?.kind === 'members' ? facts.students : null;
  const more = facts?.kind === 'members' && facts.more;
  return <p className="d-hero-facts">
    <span className="d-hero-fact"><Icon name="clock" size={16} />{next.happening ? <><LocalDate value={next.startsAt} options={clock} /> – <LocalDate value={next.endsAt} options={clock} /></> : <LocalDate value={next.startsAt} options={sessionTime} />}</span>
    <span className="d-hero-fact"><Icon name={next.mode === 'online' ? 'video' : 'pin'} size={16} />{next.mode === 'online' ? <L id="th.next.online" /> : <span><L id="th.next.center" />{next.location && <> · <bdi dir="auto">{next.location}</bdi></>}</span>}</span>
    {students !== null && <span data-next-students className="d-hero-fact"><Icon name="students" size={16} /><L id={more ? 'th.next.students_more' : students === 1 ? 'th.next.student_one' : 'th.next.students'} values={{ count: number(students) }} /></span>}
  </p>;
}

/** The one heavy thing on the screen: the class happening now, or the next one. */
function NextSession({ data, facts, retry, now: clock, emptyId = 'th.next.empty' }: { data: HomeData['sessions']; facts: HomeData['nextFacts']; retry: Retry; now: number; emptyId?: 'th.next.empty' | 'th.first.next' }) {
  const next = data.state === 'ready' ? data.data.next : null;
  if (data.state === 'unavailable') return null;
  if (!next) return <Card list aria-labelledby="th-next" data-section="th-next">
    <CardHead id="th-next" title={<L id="th.next.title" />} />
    {data.state === 'error' ? <div className="pb-3"><SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} /></div> : <Quiet id={emptyId} />}
  </Card>;
  const now = next.happening;
  // The live class's attendance was finished: say so and offer to edit it, instead of asking for it again. A draft (even with marks) still says Take attendance and continues.
  const taken = now && next.attendance === 'finalized';
  const ring = now && facts?.kind === 'marked' && facts.total > 0 ? facts : null;
  return <section aria-labelledby="th-next" data-section="th-next"><div data-tour="next-session" data-next-session={next.id} data-happening-now={now ? 'true' : undefined} className="d-hero">
    <div className="d-hero-main">
      {ring && <Ring marked={ring.marked} total={ring.total} />}
      <div className="d-hero-text">
        <h2 id="th-next" className="d-hero-heading"><span className="d-pill d-hero-pill">{now && <span aria-hidden className="d-pill-dot" />}<L id={now ? 'th.next.now' : 'th.next.title'} /></span></h2>
        <p className="d-hero-title"><bdi dir="auto">{next.groupName}</bdi></p>
        <p className="d-body"><bdi dir="auto">{next.title}</bdi></p>
        <Facts next={next} facts={facts} />
        {!now && <Countdown as="p" startsAt={next.startsAt} now={clock} />}
        {data.state === 'ready' && data.data.partial && <p className="d-meta"><L id="th.next.partial" /></p>}
      </div>
    </div>
    <div className="d-hero-actions">
      {/* During a live class, taking attendance is the main thing to do: it is first, on every width, and opening the Group is the quiet second button. */}
      {now && !taken && <Link href={attendanceHref(next.groupId, next.id)} data-tour="take-attendance" data-take-attendance className={buttonClass('primary', { size: 'lg' })}><L id="th.next.attendance" /></Link>}
      {taken && <p data-attendance-taken className="d-hero-taken"><Icon name="check" /><L id="th.next.taken" /></p>}
      {taken && <Link href={attendanceHref(next.groupId, next.id)} data-edit-attendance className={buttonClass('primary', { size: 'lg' })}><L id="ta.edit" /></Link>}
      <Link href={`/teacher/groups/${next.groupId}`} data-open-group className={buttonClass(now ? 'secondary' : 'primary', { size: 'lg' })}><L id="th.next.open" /></Link>
    </div>
  </div></section>;
}

/** A finished session still waiting for attendance. */
function UnsavedRow({ s }: { s: HomeUnsaved }) {
  const { t } = useLanguage();
  return <ListRow data-unsaved-session={s.id} action leading={<IconBadge name="warning" tone="warning" />}
    title={<bdi dir="auto">{s.groupName}</bdi>}
    meta={<LocalDate value={s.startsAt} options={dayAndTime} />}
    trailing={<><StatusPill tone="warning"><L id="tg.att.unsaved" /></StatusPill><Link href={attendanceHref(s.groupId, s.id)} data-unsaved-finish aria-label={t('th.coming.take_for', { group: s.groupName })} className={buttonClass('attention', { size: 'lg' })}><L id="th.next.attendance" /></Link></>} />;
}

/** Only what asks for something. Shown when there is something, or when a read failed (a failed read is never "nothing to do"). */
function NeedsAttention({ unsaved, waiting, retry }: { unsaved: HomeData['unsaved']; waiting: HomeData['waiting']; retry: Retry }) {
  const { number } = useLanguage();
  const rows = unsaved.state === 'ready' ? unsaved.data : [];
  const asking = waiting.state === 'ready' ? waiting.data.count : 0;
  const failed = unsaved.state === 'error' ? unsaved.status : waiting.state === 'error' ? waiting.status : undefined;
  const total = rows.length + (asking > 0 ? 1 : 0);
  if (!total && failed === undefined) return null;
  return <Card list aria-labelledby="th-attention" data-section="th-attention">
    <CardHead id="th-attention" title={<L id="th.attention.title" />} badge={total > 0 ? <StatusPill tone="warning">{number(total)}</StatusPill> : undefined} />
    {failed !== undefined && <div className="pb-3"><SectionError status={failed} onRetry={retry.retry} pending={retry.pending} /></div>}
    {total > 0 && <ul className="d-list" data-tour="unsaved-attendance" data-unsaved-list>
      {rows.map(u => <UnsavedRow key={u.id} s={u} />)}
      {asking > 0 && <ListRow data-waiting-requests action leading={<IconBadge name="user-plus" tone="info" />}
        title={<L id="th.attention.asked" />}
        meta={<L id="th.attention.waiting_meta" />}
        trailing={<><StatusPill tone="info"><L id="th.attention.waiting" values={{ count: number(asking) }} /></StatusPill><Link href="/teacher/students" data-waiting-review className={buttonClass('secondary')}><L id="th.attention.review" /></Link></>} />}
    </ul>}
  </Card>;
}

function ComingUp({ data, retry, now }: { data: HomeData['sessions']; retry: Retry; now: number }) {
  if (data.state === 'unavailable') return null;
  return <Card list aria-labelledby="th-coming" data-section="th-coming">
    <CardHead id="th-coming" title={<L id="th.coming.title" />} />
    {data.state === 'error' ? <div className="pb-3"><SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} /></div>
      : !data.data.comingUp.length ? <Quiet id="th.coming.empty" />
      : <ul className="d-list">{data.data.comingUp.map(s => <ListRow key={s.id} data-session={s.id} href={`/teacher/groups/${s.groupId}`} leading={<DateTile value={s.startsAt} />}
        title={<bdi dir="auto">{s.groupName}</bdi>}
        meta={<><bdi dir="auto">{s.title}</bdi> · <LocalDate value={s.startsAt} options={shortDayAndTime} /><Countdown startsAt={s.startsAt} now={now} /></>} />)}</ul>}
  </Card>;
}

function Updates({ data, retry }: { data: HomeData['updates']; retry: Retry }) {
  if (data.state === 'unavailable') return null;
  return <Card list aria-labelledby="th-updates" data-section="th-updates">
    <CardHead id="th-updates" title={<L id="th.updates.title" />} action={<Link href="/notifications" data-updates-all className={buttonClass('tertiary')}><L id="th.updates.all" /></Link>} />
    {data.state === 'error' ? <div className="pb-3"><SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} /></div>
      : !data.data.items.length ? <Quiet id="th.updates.empty" />
      : <ul className="d-list">{data.data.items.map(u => <ListRow key={u.id} data-update={u.id} leading={<IconBadge name={u.sessionChange ? 'calendar' : 'bell'} tone={u.sessionChange ? 'warning' : 'neutral'} />}
        title={<>{u.sessionChange && <span className="sr-only"><L id="th.updates.session" />: </span>}{u.link ? <Link href={u.link} className="d-focus inline-flex min-h-[44px] items-center underline underline-offset-4"><L text={eventLabels[u.event]} /></Link> : <L text={eventLabels[u.event]} />}</>}
        meta={<LocalDate value={u.createdAt} options={{ ...zone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }} />} />)}</ul>}
  </Card>;
}

/** Shown only when the server confirmed that every teaching space of this teacher is a demo space. */
function DemoLabel() {
  return <StatusPill tone="warning" data-demo-label><L id="demo.space_label" /></StatusPill>;
}

/** Calm first visit: no tour, no steps, no numbers. Shown only when both reads succeeded and found nothing. */
function FirstVisit({ data }: { data: HomeData }) {
  const retry = useRetry();
  const now = useServerNow(data.now);
  const [how, setHow] = useState(false);
  return <div data-first-visit className="d-page">
    <PageHeader title={<L id="th.first.title" />} pill={data.demo ? <DemoLabel /> : undefined} meta={<L id="th.first.intro" />} />
    <section aria-labelledby="th-first-step" data-first-hero className="d-hero">
      <div className="d-hero-text">
        <p className="d-section-label"><L id="th.first.eyebrow" /></p>
        <h2 id="th-first-step" className="d-hero-title"><L id="th.first.step_title" /></h2>
        <p className="d-body"><L id="th.first.step_body" /></p>
        {how && <p id="th-first-how" className="d-label"><L id="th.first.how_body" /></p>}
      </div>
      <div className="d-hero-actions">
        <CreateCourse targets={data.createTargets} />
        <Button type="button" aria-expanded={how} aria-controls="th-first-how" onClick={() => setHow(v => !v)}><L id="th.first.how" /></Button>
      </div>
    </section>
    <div className="grid gap-5 md:grid-cols-2">
      <NextSession data={data.sessions} facts={data.nextFacts} retry={retry} now={now} emptyId="th.first.next" />
      <Updates data={data.updates} retry={retry} />
    </div>
    <p className="d-body"><L id="th.first.help" /> <Link href="/support" className="d-focus font-bold underline underline-offset-4"><L id="th.first.help_link" /></Link>. <L id="th.first.help_end" /></p>
  </div>;
}

/**
 * Greeting, the small numbers, the hero, then two columns on a desktop (what needs you and what is coming | updates). A phone stacks the same order.
 * Homework to correct returns here with the Homework build. Courses are not on Home: they have their own menu item.
 */
export function TeacherHomeView({ data }: { data: HomeData }) {
  if (data.firstVisit) return <FirstVisit data={data} />;
  return <ReturningHome data={data} />;
}

function ReturningHome({ data }: { data: HomeData }) {
  const retry = useRetry();
  const now = useServerNow(data.now);
  return <div data-teacher-home className="d-page">
    <PageHeader title={<Greeting now={data.now} />} pill={data.demo ? <DemoLabel /> : undefined} meta={<HomeMeta now={data.now} today={data.sessionsToday} />} />
    <Summary data={data.summary} />
    <NextSession data={data.sessions} facts={data.nextFacts} retry={retry} now={now} />
    <div className="d-home-grid">
      <div className="d-home-col">
        <NeedsAttention unsaved={data.unsaved} waiting={data.waiting} retry={retry} />
        <ComingUp data={data.sessions} retry={retry} now={now} />
      </div>
      <div className="d-home-col"><Updates data={data.updates} retry={retry} /></div>
    </div>
  </div>;
}

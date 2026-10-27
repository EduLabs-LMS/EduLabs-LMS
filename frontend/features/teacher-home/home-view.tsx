'use client';
import Link from 'next/link';
import { CalendarClock, MapPin, Video } from 'lucide-react';
import { L, LocalDate } from '@/frontend/components/language-provider';
import EduLabsMark from '@/frontend/components/edulabs-mark';
import { eventLabels } from '@/shared/contracts/communications';
import { COURSE_LIMIT, type HomeSession, type TeacherHomeLoad } from '@/shared/teacher-home';
import { CreateCourse } from './create-course';
import { CourseCards, Empty, Section, SectionError, SectionUnavailable, card, linkClass, plainButton, sessionTime, useRetry } from './parts';

type HomeData = TeacherHomeLoad;

function SessionLine({ s }: { s: HomeSession }) {
  return <li className="flex flex-col gap-1 border-t-2 border-black/15 pt-3 first:border-t-0 first:pt-0" data-session={s.id}>
    <span className="break-words text-base font-bold"><bdi dir="auto">{s.groupName}</bdi></span>
    <span className="break-words text-base text-slate-800"><bdi dir="auto">{s.title}</bdi></span>
    <span className="text-base text-slate-700"><LocalDate value={s.startsAt} options={sessionTime} /></span>
  </li>;
}

function NextSession({ data, retry }: { data: HomeData['sessions']; retry: ReturnType<typeof useRetry> }) {
  return <Section id="th-next" title={<L id="th.next.title" />} className="bg-primary/30 lg:col-start-1 lg:row-start-1">
    {data.state === 'error' ? <SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} />
      : data.state === 'unavailable' ? null
      : !data.data.next ? <Empty id="th.next.empty" />
      : <div className="space-y-3" data-next-session={data.data.next.id}>
        <p className="break-words font-display text-3xl leading-tight"><bdi dir="auto">{data.data.next.groupName}</bdi></p>
        <p className="break-words text-lg"><bdi dir="auto">{data.data.next.title}</bdi></p>
        <p className="flex items-center gap-2 text-lg font-bold"><CalendarClock aria-hidden className="h-5 w-5 shrink-0" /><LocalDate value={data.data.next.startsAt} options={sessionTime} /></p>
        <p className="flex items-center gap-2 text-base">{data.data.next.mode === 'online' ? <Video aria-hidden className="h-5 w-5 shrink-0" /> : <MapPin aria-hidden className="h-5 w-5 shrink-0" />}
          {data.data.next.mode === 'online' ? <L id="th.next.online" /> : <><L id="th.next.center" />{data.data.next.location && <> · <bdi dir="auto">{data.data.next.location}</bdi></>}</>}</p>
        <Link href="/groups" className={plainButton}><L id="th.next.open" /></Link>
        {data.data.partial && <p className="text-base text-slate-700"><L id="th.next.partial" /></p>}
      </div>}
  </Section>;
}

function Homework() {
  return <Section id="th-homework" title={<L id="th.hw.title" />} className="lg:col-start-1 lg:row-start-2">
    <SectionUnavailable messageId="th.hw.unavailable" action={<Link href="/admin/submissions" className={linkClass}><L id="th.hw.open" /></Link>} />
  </Section>;
}

function Updates({ data, retry }: { data: HomeData['updates']; retry: ReturnType<typeof useRetry> }) {
  return <Section id="th-updates" title={<L id="th.updates.title" />} className="lg:col-start-2 lg:row-start-1">
    {data.state === 'error' ? <SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} />
      : data.state === 'unavailable' ? null
      : !data.data.items.length ? <Empty id="th.updates.empty" />
      : <>
        <p className="text-base text-slate-700"><L id="th.updates.unread" values={{ count: data.data.unread }} /></p>
        <ul className="space-y-3">{data.data.items.map(u => <li key={u.id} data-update={u.id} className="space-y-1 rounded-2xl border-2 border-black bg-white p-3">
          {u.sessionChange && <span className="inline-flex min-h-[24px] items-center rounded-full border-2 border-black bg-primary px-2 text-base font-bold text-black"><L id="th.updates.session" /></span>}
          <p className="break-words text-base font-bold">{u.link ? <Link href={u.link} className="inline-flex min-h-[44px] items-center underline underline-offset-4"><L text={eventLabels[u.event]} /></Link> : <L text={eventLabels[u.event]} />}</p>
          <p className="text-base text-slate-700"><LocalDate value={u.createdAt} options={{ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }} /></p>
        </li>)}</ul>
      </>}
    <Link href="/notifications" className={linkClass}><L id="th.updates.all" /></Link>
  </Section>;
}

function ComingUp({ data, retry }: { data: HomeData['sessions']; retry: ReturnType<typeof useRetry> }) {
  return <Section id="th-coming" title={<L id="th.coming.title" />} className="lg:col-start-1 lg:row-start-3">
    {data.state === 'error' ? <SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} />
      : data.state === 'unavailable' ? null
      : !data.data.comingUp.length ? <Empty id="th.coming.empty" />
      : <ul className="space-y-3">{data.data.comingUp.map(s => <SessionLine key={s.id} s={s} />)}</ul>}
  </Section>;
}

function Courses({ data, targets, retry }: { data: HomeData['courses']; targets: HomeData['createTargets']; retry: ReturnType<typeof useRetry> }) {
  return <Section id="th-courses" title={<L id="th.courses.title" />} className="lg:col-start-2 lg:row-span-2 lg:row-start-2">
    {data.state === 'error' ? <SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} />
      : data.state === 'unavailable' ? null
      : !data.data.items.length ? <Empty id="th.courses.empty" />
      : <CourseCards compact items={data.data.items.slice(0, 6)} />}
    {data.state === 'ready' && data.data.items.length > 0 && <Link href="/teacher/courses" className={linkClass}><L id="th.courses.all" /></Link>}
    {data.state === 'ready' && data.data.truncated && <p className="text-base text-slate-700"><L id="th.courses.truncated" values={{ count: COURSE_LIMIT }} /></p>}
    <CreateCourse targets={targets} className="w-full" />
  </Section>;
}

/** Calm first visit: no tour, no steps, no numbers. Shown only when both reads succeeded and found nothing. */
function FirstVisit({ targets }: { targets: HomeData['createTargets'] }) {
  return <div data-first-visit className={`${card} mx-auto flex max-w-2xl flex-col items-center gap-5 py-10 text-center`}>
    <EduLabsMark className="h-24 w-24" />
    <h1 className="font-display text-3xl"><L id="th.first.title" /></h1>
    <p className="max-w-prose text-lg text-slate-800"><L id="th.first.body" /></p>
    <CreateCourse targets={targets} />
    <p className="text-base text-slate-700"><L id="th.first.groups" /> <Link href="/groups" className="font-bold underline underline-offset-4"><L id="th.first.groups_link" /></Link></p>
  </div>;
}

export function TeacherHomeView({ data }: { data: HomeData }) {
  const retry = useRetry();
  if (data.firstVisit) return <FirstVisit targets={data.createTargets} />;
  return <div data-teacher-home className="mx-auto w-full max-w-6xl space-y-5">
    <header className="flex items-center gap-4 rounded-[24px] border-[2.5px] border-black bg-primary p-4 shadow-hard sm:p-5">
      <EduLabsMark tone="ink" shadow={false} className="h-12 w-12 shrink-0" />
      <div className="min-w-0"><h1 className="font-display text-3xl leading-tight"><L id="th.home.title" /></h1><p className="text-base text-black"><L id="th.home.intro" /></p></div>
    </header>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <NextSession data={data.sessions} retry={retry} />
      <Homework />
      <Updates data={data.updates} retry={retry} />
      <ComingUp data={data.sessions} retry={retry} />
      <Courses data={data.courses} targets={data.createTargets} retry={retry} />
    </div>
  </div>;
}

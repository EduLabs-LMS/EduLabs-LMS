'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarClock, MapPin, Video } from 'lucide-react';
import { L, LocalDate } from '@/frontend/components/language-provider';
import { eventLabels } from '@/shared/contracts/communications';
import { cn } from '@/shared/utils';
import type { HomeSession, HomeUnsaved, TeacherHomeLoad } from '@/shared/teacher-home';
import { attendanceHref } from '@/shared/teacher-attendance';
import { CreateCourse } from './create-course';
import { Empty, Section, SectionError, inkButton, linkClass, plainButton, sessionTime, useRetry } from './parts';

type HomeData = TeacherHomeLoad;
type Retry = ReturnType<typeof useRetry>;

const zone = { timeZone: 'Africa/Cairo' } as const;

function SessionRow({ s }: { s: HomeSession }) {
  return <li className="flex items-center gap-3 border-t-2 border-black/15 py-3 first:border-t-0" data-session={s.id}>
    <span aria-hidden className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-black bg-primary/30 font-bold leading-tight">
      <span className="text-base"><LocalDate value={s.startsAt} options={{ ...zone, month: 'short' }} /></span>
      <span className="text-xl"><LocalDate value={s.startsAt} options={{ ...zone, day: 'numeric' }} /></span>
    </span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="break-words text-base font-bold"><bdi dir="auto">{s.title}</bdi></span>
      <span className="break-words text-base text-slate-700"><L id="th.coming.kind" /> · <bdi dir="auto">{s.groupName}</bdi></span>
      <span className="text-base text-slate-700"><LocalDate value={s.startsAt} options={{ ...zone, weekday: 'long', hour: 'numeric', minute: '2-digit' }} /></span>
    </span>
  </li>;
}

/** `hero` is the highlighted card on Home; the first visit shows the same read as a quiet card. */
function NextSession({ data, retry, slot, hero = true }: { data: HomeData['sessions']; retry: Retry; slot?: string; hero?: boolean }) {
  const next = data.state === 'ready' ? data.data.next : null;
  const now = Boolean(next?.happening);
  return <Section id="th-next" eyebrow={hero} title={<L id={now ? 'th.next.now' : 'th.next.title'} />} className={cn(hero && 'bg-primary/30', slot)}>
    {data.state === 'error' ? <SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} />
      : data.state === 'unavailable' ? null
      : !next ? <Empty id={hero ? 'th.next.empty' : 'th.first.next'} />
      : <div className="space-y-3" data-tour="next-session" data-next-session={next.id} data-happening-now={now ? 'true' : undefined}>
        <p className="flex items-start gap-2 break-words font-display text-3xl leading-tight lg:text-4xl"><CalendarClock aria-hidden className="mt-1.5 h-6 w-6 shrink-0" /><span><LocalDate value={next.startsAt} options={sessionTime} /></span></p>
        <p className="break-words text-xl font-bold"><bdi dir="auto">{next.groupName}</bdi></p>
        <p className="break-words text-base"><bdi dir="auto">{next.title}</bdi></p>
        <p className="flex items-center gap-2 text-base">{next.mode === 'online' ? <Video aria-hidden className="h-5 w-5 shrink-0" /> : <MapPin aria-hidden className="h-5 w-5 shrink-0" />}
          {next.mode === 'online' ? <L id="th.next.online" /> : <><L id="th.next.center" />{next.location && <> · <bdi dir="auto">{next.location}</bdi></>}</>}</p>
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap">
          <Link href={`/teacher/groups/${next.groupId}`} className={cn(inkButton, 'min-h-[48px] sm:min-h-[44px]')}><L id="th.next.open" /></Link>
          {now && <Link href={attendanceHref(next.groupId, next.id)} data-tour="take-attendance" data-take-attendance className={cn(plainButton, 'min-h-[48px] sm:min-h-[44px]')}><L id="th.next.attendance" /></Link>}
        </div>
        {data.data.partial && <p className="text-base text-slate-800"><L id="th.next.partial" /></p>}
      </div>}
  </Section>;
}


function Updates({ data, retry, slot }: { data: HomeData['updates']; retry: Retry; slot?: string }) {
  return <Section id="th-updates" title={<L id="th.updates.title" />} className={slot}>
    {data.state === 'error' ? <SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} />
      : data.state === 'unavailable' ? null
      : !data.data.items.length ? <Empty id="th.updates.empty" />
      : <ul>{data.data.items.map(u => <li key={u.id} data-update={u.id} className="flex items-start gap-3 border-t-2 border-black/15 py-3 first:border-t-0">
        <span aria-hidden className={cn('mt-2 h-3 w-3 shrink-0 rounded-full border-2 border-black', u.sessionChange ? 'bg-rose-300' : 'bg-primary')} />
        <span className="flex min-w-0 flex-col">
          <span className="break-words text-base font-bold">{u.sessionChange && <span className="sr-only"><L id="th.updates.session" />: </span>}
            {u.link ? <Link href={u.link} className="inline-flex min-h-[44px] items-center underline underline-offset-4"><L text={eventLabels[u.event]} /></Link> : <L text={eventLabels[u.event]} />}</span>
          <span className="text-base text-slate-700"><LocalDate value={u.createdAt} options={{ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }} /></span>
        </span>
      </li>)}</ul>}
    <Link href="/notifications" className={linkClass}><L id="th.updates.all" /></Link>
  </Section>;
}

/** A finished session still waiting for attendance: date, Group, the plain reason and one yellow "Finish" button that opens its attendance. */
function UnsavedRow({ s }: { s: HomeUnsaved }) {
  return <li className="flex items-center gap-3 border-t-2 border-black/15 py-3 first:border-t-0" data-unsaved-session={s.id}>
    <span aria-hidden className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-black bg-amber-100 font-bold leading-tight text-black">
      <span className="text-base"><LocalDate value={s.startsAt} options={{ ...zone, month: 'short' }} /></span>
      <span className="text-xl"><LocalDate value={s.startsAt} options={{ ...zone, day: 'numeric' }} /></span>
    </span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="break-words text-base font-bold"><bdi dir="auto">{s.groupName}</bdi></span>
      <span className="text-base text-slate-700"><LocalDate value={s.startsAt} options={{ ...zone, weekday: 'long', hour: 'numeric', minute: '2-digit' }} /></span>
      <span className="text-base font-bold text-slate-800"><L id="th.coming.unsaved" /></span>
    </span>
    <Link href={attendanceHref(s.groupId, s.id)} data-unsaved-finish className="inline-flex min-h-[48px] shrink-0 items-center justify-center rounded-2xl border-2 border-black bg-amber-300 px-4 text-base font-bold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"><L id="th.coming.finish" /></Link>
  </li>;
}

function ComingUp({ data, unsaved, retry, slot }: { data: HomeData['sessions']; unsaved: HomeData['unsaved']; retry: Retry; slot?: string }) {
  const rows = unsaved.state === 'ready' ? unsaved.data : [];
  return <Section id="th-coming" title={<L id="th.coming.title" />} className={slot}>
    {data.state === 'error' ? <SectionError status={data.status} onRetry={retry.retry} pending={retry.pending} />
      : data.state === 'unavailable' ? null
      : <>
        {unsaved.state === 'error' && <SectionError status={unsaved.status} onRetry={retry.retry} pending={retry.pending} />}
        {rows.length > 0 && <ul data-tour="unsaved-attendance" data-unsaved-list>{rows.map(u => <UnsavedRow key={u.id} s={u} />)}</ul>}
        {!data.data.comingUp.length ? <Empty id="th.coming.empty" /> : <ul>{data.data.comingUp.map(x => <SessionRow key={x.id} s={x} />)}</ul>}
      </>}
  </Section>;
}

/** Shown only when the server confirmed that every teaching space of this teacher is a demo space. */
function DemoLabel() {
  return <span data-demo-label className="inline-flex min-h-[28px] w-fit items-center rounded-full border-2 border-black bg-amber-100 px-3 text-base font-bold text-black"><L id="demo.space_label" /></span>;
}

/** Calm first visit: no tour, no steps, no numbers. Shown only when both reads succeeded and found nothing. */
function FirstVisit({ data }: { data: HomeData }) {
  const retry = useRetry();
  const [how, setHow] = useState(false);
  return <div data-first-visit className="mx-auto w-full max-w-6xl space-y-6">
    <header className="space-y-1">
      {data.demo && <DemoLabel />}
      <h1 className="font-display text-3xl leading-tight lg:text-4xl"><L id="th.first.title" /></h1>
      <p className="text-base text-slate-700"><L id="th.first.intro" /></p>
    </header>
    <section aria-labelledby="th-first-step" className="flex flex-wrap items-center justify-between gap-6 rounded-[24px] border-[2.5px] border-black bg-primary p-5 shadow-hard sm:p-8">
      <div className="max-w-xl space-y-2">
        <p className="text-base font-bold uppercase tracking-wider"><L id="th.first.eyebrow" /></p>
        <h2 id="th-first-step" className="font-display text-3xl leading-tight"><L id="th.first.step_title" /></h2>
        <p className="text-lg"><L id="th.first.step_body" /></p>
        {how && <p id="th-first-how" className="text-base font-bold"><L id="th.first.how_body" /></p>}
      </div>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
        <CreateCourse targets={data.createTargets} ink className="min-h-[48px]" />
        <button type="button" aria-expanded={how} aria-controls="th-first-how" onClick={() => setHow(v => !v)} className={cn(plainButton, 'min-h-[48px]')}><L id="th.first.how" /></button>
      </div>
    </section>
    <div className="grid gap-5 md:grid-cols-2">
      <NextSession data={data.sessions} retry={retry} hero={false} />
      <Updates data={data.updates} retry={retry} />
    </div>
    <p className="text-base text-slate-700"><L id="th.first.help" /> <Link href="/support" className="font-bold underline underline-offset-4"><L id="th.first.help_link" /></Link>. <L id="th.first.help_end" /></p>
  </div>;
}

/**
 * Two columns on a desktop (your day | your inbox), one column on a phone. The column wrappers dissolve on a phone
 * (`contents`), so `order` sets the phone sequence: next session, updates, coming up. Homework to correct returns here with the Homework build. Courses are not on Home: they live in Settings, Courses.
 */
export function TeacherHomeView({ data }: { data: HomeData }) {
  const retry = useRetry();
  if (data.firstVisit) return <FirstVisit data={data} />;
  return <div data-teacher-home className="mx-auto w-full max-w-6xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {data.demo && <DemoLabel />}
        <h1 className="font-display text-3xl leading-tight lg:text-4xl"><L id="th.home.title" /></h1>
        <p className="hidden text-base text-slate-700 lg:block"><L id="th.home.intro" /></p>
      </div>
    </header>
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-7">
      <div className="contents lg:flex lg:flex-col lg:gap-5">
        <NextSession data={data.sessions} retry={retry} slot="order-1 lg:order-none" />
        <ComingUp data={data.sessions} unsaved={data.unsaved} retry={retry} slot="order-3 lg:order-none" />
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-5">
        <Updates data={data.updates} retry={retry} slot="order-2 lg:order-none" />
      </div>
    </div>
  </div>;
}

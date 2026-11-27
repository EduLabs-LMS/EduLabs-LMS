'use client';
import Link from 'next/link';
import { CalendarClock, ChevronRight, MapPin, Users, Video } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';

/** One of the student's own Groups, as the existing group read gives it (no new read, no permission of its own). */
export type YourGroup = { id: string; name: string; courseTitle: string; mode: 'online' | 'center'; nextStartsAt: string | null };

/**
 * "Your Groups" on the student pages: the Group's name, its course and the next session, in words a student reads.
 * The caller leaves it out when the student has no Group (or the read failed), so it never shows an empty or technical box.
 */
export function YourGroups({ groups, showCourse }: { groups: YourGroup[]; showCourse: boolean }) {
  const { language } = useLanguage();
  if (!groups.length) return null;
  const when = (iso: string) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
  return <section data-your-groups aria-labelledby="your-groups-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <h2 id="your-groups-title" className="mb-2 flex items-center gap-2 text-xl font-bold text-slate-950"><Users aria-hidden className="h-5 w-5 text-cyan-600" /><L id="sg.title" /></h2>
    <ul className="divide-y divide-slate-100">
      {groups.map(g => <li key={g.id}>
        <Link data-your-group={g.id} href="/group" className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl py-4 text-sm hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
          <span className="min-w-0 space-y-1">
            <span className="block font-semibold text-slate-950"><bdi dir="auto">{g.name}</bdi>{showCourse && g.courseTitle && <span className="font-normal text-slate-600"> · <bdi dir="auto">{g.courseTitle}</bdi></span>}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
              <span className="inline-flex items-center gap-1.5">{g.mode === 'online' ? <Video aria-hidden className="h-4 w-4" /> : <MapPin aria-hidden className="h-4 w-4" />}<L id={g.mode === 'online' ? 'sg.online' : 'sg.center'} /></span>
              <span data-next-session className="inline-flex items-center gap-1.5"><CalendarClock aria-hidden className="h-4 w-4" />{g.nextStartsAt ? <L id="sg.next" values={{ when: when(g.nextStartsAt) }} /> : <L id="sg.none" />}</span>
            </span>
          </span>
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-400 rtl:rotate-180" />
        </Link>
      </li>)}
    </ul>
  </section>;
}

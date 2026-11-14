import { L, LocalSessionDate } from '@/frontend/components/language-provider';
import Link from 'next/link';
import { CalendarDays, Video } from 'lucide-react';
import SessionCountdown from '@/frontend/components/session-countdown';
import { cn } from '@/shared/utils';

interface UpcomingSessionProps {
	session: { date: string | Date; fullFormatted: string; endDate?:string } | null;
	serverNow?: string;
	groupName?: string | null;
	description?: string;
	className?: string;
	/** The EduLabs class page of this Session, when it is one (shown only when live classes are on). */
	joinHref?: string | null;
}

export default function UpcomingSession({
	serverNow,
	session,
	groupName,
	description = 'Have your notes and questions ready for class.',
	className,
	joinHref,
}: UpcomingSessionProps) {
	return (
		<div className={cn('min-w-0 space-y-4 rounded-2xl bg-white text-slate-900', className)}>
			<div className="flex min-w-0 items-start gap-3">
				<div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700">
					<CalendarDays className="h-5 w-5" aria-hidden="true" />
				</div>
				<div className="min-w-0 space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<p className="text-xs font-semibold uppercase tracking-wider text-slate-500"><L id="common.next_class"/></p>
						{groupName && <span className="max-w-full break-words rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">{groupName}</span>}
					</div>
					<h3 className="break-words text-lg font-semibold leading-snug tracking-tight text-slate-900 sm:text-xl">
						{session ? <LocalSessionDate value={session.date} englishFallback={session.fullFormatted}/> : <L id="dynamic.nextClass"/>}
					</h3>
					<p className="text-sm leading-relaxed text-slate-500">
						{session ? <L text={description}/> : groupName ? <L id="dynamic.schedulePending"/> : <L id="dynamic.scheduleAssignment"/>}
					</p>
				</div>
			</div>
			{session && <SessionCountdown targetDate={session.date} endDate={session.endDate} serverNow={serverNow} />}
			{session && joinHref && <Link href={joinHref} data-live-class-join className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"><Video className="h-4 w-4" aria-hidden="true" /><L id="lc.join"/></Link>}
		</div>
	);
}

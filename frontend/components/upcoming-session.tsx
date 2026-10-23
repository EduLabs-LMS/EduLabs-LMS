import { L, LocalSessionDate } from '@/frontend/components/language-provider';
import { CalendarDays } from 'lucide-react';
import SessionCountdown from '@/frontend/components/session-countdown';
import { cn } from '@/shared/utils';

interface UpcomingSessionProps {
	session: { date: string | Date; fullFormatted: string; endDate?:string } | null;
	serverNow?: string;
	groupName?: string | null;
	description?: string;
	className?: string;
}

export default function UpcomingSession({
	serverNow,
	session,
	groupName,
	description = 'Have your notes and questions ready for class.',
	className,
}: UpcomingSessionProps) {
	return (
		<div className={cn('min-w-0 space-y-4 rounded-2xl bg-white text-slate-900', className)}>
			<div className="flex min-w-0 items-start gap-3">
				<div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green-50 text-green-900">
					<CalendarDays className="h-5 w-5" aria-hidden="true" />
				</div>
				<div className="min-w-0 space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<p className="text-xs font-semibold uppercase tracking-wider text-slate-500"><L id="common.next_class"/></p>
						{groupName && <span className="max-w-full break-words rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-900">{groupName}</span>}
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
		</div>
	);
}

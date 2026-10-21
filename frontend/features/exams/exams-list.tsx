import { L, LocalCount, LocalDate, LocalDuration, LocalAttempts } from '@/frontend/components/language-provider';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
	AlertTriangle,
	ArrowLeft,
	CalendarClock,
	CheckCircle2,
	Clock,
	FileText,
	Hourglass,
	Lock,
	PlayCircle,
	RotateCcw,
	Send,
	type LucideIcon,
} from 'lucide-react';

import {
	formatAttempts,
	formatTimeLimit,
	type ExamListItem,
	type ExamListState,
} from '@/shared/contracts/exam-listing';
import { cn } from '@/shared/utils';
import { ExamsRetry } from '@/frontend/features/exams/exams-retry';

/**
 * Server-renderable (no client hooks) views for the Firebase/Supabase Exams
 * foundation. Reuses the V2 card styling of the original ExamsView.
 * These views are READ-ONLY: starting attempts, retry decisions, answer review
 * and grading are separate deliveries that need backend contracts.
 */

const cardClass = 'rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm';

const STATE: Record<ExamListState, { text: string; className: string; icon: LucideIcon }> = {
	NOT_STARTED: { text: 'Not started', className: 'bg-white', icon: PlayCircle },
	IN_PROGRESS: { text: 'In progress', className: 'bg-amber-200', icon: Clock },
	TIME_EXPIRED: { text: 'Time expired', className: 'bg-rose-100', icon: AlertTriangle },
	SUBMITTED: { text: 'Submitted', className: 'bg-primary', icon: Send },
	GRADED: { text: 'Graded', className: 'bg-primary', icon: CheckCircle2 },
	NOT_OPEN_YET: { text: 'Opens later', className: 'bg-slate-100', icon: CalendarClock },
	CLOSED: { text: 'Closed', className: 'bg-slate-100', icon: Lock },
};

const utc = (iso: string | null) => iso ? <LocalDate compactUtc value={iso} options={{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}}/> : null;

function Header({ isStaff, action }: { isStaff: boolean; action?: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-black bg-white p-5 shadow-hard">
			<div className="flex items-center gap-3">
				<div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-primary">
					<FileText className="h-6 w-6" />
				</div>
				<div>
					<h1 className="font-display text-3xl leading-none"><L id="navigation.exams"/></h1>
					<p className="mt-1 text-sm text-slate-600">
						{isStaff
							? <L id="exam.staffIntro"/>
							: <L id="exam.studentIntro"/>}
					</p>
				</div>
			</div>
            {action}
		</div>
	);
}

function StateBadge({ state }: { state: ExamListState }) {
	const { text, className, icon: Icon } = STATE[state];
	return (
		<span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-black px-2.5 py-0.5 text-xs font-semibold', className)}>
			<Icon aria-hidden className="h-3.5 w-3.5" />
			<L text={text}/>
		</span>
	);
}

function Facts({ exam }: { exam: ExamListItem }) {
	return (
		<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-700">
			<span className="flex items-center gap-1">
				<Clock aria-hidden className="h-3.5 w-3.5" /> <LocalDuration seconds={exam.timeLimitSeconds}/>
			</span>
			<span className="flex items-center gap-1">
				<RotateCcw aria-hidden className="h-3.5 w-3.5" /> <LocalAttempts count={exam.maxAttempts}/>
			</span>
			<span>{exam.questionCount === null ? <L id="exam.countUnavailable"/> : <LocalCount count={exam.questionCount} noun="questions"/>}</span>
			<span className="capitalize"><L id={`exam.kind.${exam.kind}` as "exam.kind.exam"}/></span>
		</div>
	);
}

/** Only staff-finalized ('graded') attempts expose a mark; anything else stays unannounced. */
function releasedMark(exam: ExamListItem) {
	const graded = [...exam.attempts].reverse().find((a) => a.status === 'graded' && a.score !== null && a.maxScore !== null);
	return graded ? `${graded.score} / ${graded.maxScore}` : null;
}

export function ExamsListView({ items, isStaff, truncated, action }: { items: ExamListItem[]; isStaff: boolean; truncated: boolean; action?: ReactNode }) {
	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
			<Header isStaff={isStaff} action={action} />
			{truncated && (
				<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><L id="exams.this_list_is_partial_because"/></p>
			)}
			{isStaff && (
				<p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><L id="exams.exam_creation_settings_and_grading"/></p>
			)}
			{items.length === 0 ? (
				<div className={cn(cardClass, 'text-center text-slate-600')}>
					{isStaff ? <L id="exam.noneStaff"/> : <L id="exam.noneStudent"/>}
				</div>
			) : (
				<ul className="grid gap-4 md:grid-cols-2">
					{items.map((exam) => {
						const mark = releasedMark(exam);
						return (
							<li key={exam.id}>
								<Link href={`/exams/${exam.id}`} className={cn(cardClass, 'block h-full transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2')}>
									<div className="flex items-start justify-between gap-3">
										<h2 dir="auto" className="text-lg font-bold leading-snug">{exam.title}</h2>
										<StateBadge state={exam.state} />
									</div>
									<p className="mt-1 text-xs text-slate-500">
										{exam.courseTitle ? `${exam.courseTitle} · ` : ''}{exam.offeringName}
									</p>
									{exam.instructions && <p dir="auto" className="mt-2 line-clamp-2 text-sm text-slate-600">{exam.instructions}</p>}
									<Facts exam={exam} />
									{exam.attempts.length > 0 && (
										<p className="mt-3 text-xs font-medium text-slate-700"><L id="exams.attempts_started"/>{" "}{exam.attempts.length}
											{exam.maxAttempts !== null && <L id="exam.ofLimit" values={{count:exam.maxAttempts}}/>}
										</p>
									)}
									{mark && <p className="mt-2 text-sm font-bold"><L id="exams.released_mark"/>{" "}{mark}</p>}
									{!isStaff && exam.state === 'SUBMITTED' && (
										<p className="mt-2 flex items-center gap-1 text-sm font-medium text-slate-700">
											<Hourglass aria-hidden className="h-4 w-4" />{" "}<L id="exams.results_have_not_been_released"/></p>
									)}
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

export function ExamsErrorView() {
	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
			<Header isStaff={false} />
			<div role="alert" className={cn(cardClass, 'border-rose-600 text-center')}>
				<AlertTriangle aria-hidden className="mx-auto h-6 w-6 text-rose-600" />
				<p className="mt-2 font-semibold"><L id="exams.we_could_not_load_your"/></p>
				<p className="mt-1 text-sm text-slate-600"><L id="exams.your_data_is_safe_please"/></p>
				<ExamsRetry />
			</div>
		</div>
	);
}

export function ExamNotFoundView() {
	return (
		<div className="mx-auto w-full max-w-3xl space-y-4">
			<div className={cn(cardClass, 'text-center')}>
				<p className="font-semibold"><L id="exams.this_exam_is_not_available"/></p>
				<p className="mt-1 text-sm text-slate-600"><L id="exams.it_may_not_be_published"/></p>
				<Link href="/exams" className="mt-4 inline-block text-sm font-semibold text-sky-700"><L id="exams.back_to_exams"/></Link>
			</div>
		</div>
	);
}

export function ExamDetailView({ exam, isStaff }: { exam: ExamListItem; isStaff: boolean }) {
	const mark = releasedMark(exam);
	return (
		<div className="mx-auto w-full max-w-3xl space-y-6 pb-12">
			<Link href="/exams" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700">
				<ArrowLeft aria-hidden className="h-4 w-4" />{" "}<L id="exams.back_to_exams"/></Link>
			<div className={cardClass}>
				<div className="flex items-start justify-between gap-3">
					<h1 dir="auto" className="font-display text-2xl leading-tight">{exam.title}</h1>
					<StateBadge state={exam.state} />
				</div>
				<p className="mt-1 text-xs text-slate-500">
					{exam.courseTitle ? `${exam.courseTitle} · ` : ''}{exam.offeringName}
				</p>
				{exam.instructions && <p dir="auto" className="mt-3 whitespace-pre-line text-sm text-slate-700">{exam.instructions}</p>}
				<Facts exam={exam} />
				<dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
					<div><dt className="text-xs font-bold uppercase tracking-wider text-slate-500"><L id="exams.opens"/></dt><dd>{utc(exam.opensAt) ?? <L id="exam.anyTime"/>}</dd></div>
					<div><dt className="text-xs font-bold uppercase tracking-wider text-slate-500"><L id="exams.closes"/></dt><dd>{utc(exam.closesAt) ?? <L id="exam.noDeadline"/>}</dd></div>
				</dl>
				{exam.timeLimitSeconds !== null && (
					<p className="mt-3 text-xs text-slate-500"><L id="exams.the_countdown_is_set_by"/></p>
				)}
			</div>

			<div className={cardClass}>
				<h2 className="text-lg font-bold">{isStaff ? <L id="exam.attemptsIfEnrolled"/> : <L id="exam.attempts"/>}</h2>
				{exam.attempts.length === 0 ? (
					<p className="mt-2 text-sm text-slate-600"><L id="exams.no_attempts_have_been_started"/></p>
				) : (
					<div className="mt-3 overflow-x-auto">
						<table className="w-full min-w-[420px] text-left text-sm">
							<thead className="text-xs uppercase tracking-wider text-slate-500">
								<tr><th className="py-1 pr-3"><L id="exams.attempt"/></th><th className="py-1 pr-3"><L id="exams.status"/></th><th className="py-1 pr-3"><L id="exams.started"/></th><th className="py-1"><L id="exams.submitted"/></th></tr>
							</thead>
							<tbody>
								{exam.attempts.map((a) => (
									<tr key={a.attemptNumber} className="border-t border-slate-100">
										<td className="py-2 pr-3 font-semibold">#{a.attemptNumber}</td>
										<td className="py-2 pr-3 capitalize"><L text={a.status.replace('_', ' ')}/></td>
										<td className="py-2 pr-3">{utc(a.startedAt)}</td>
										<td className="py-2">{utc(a.submittedAt) ?? '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{mark ? (
					<p className="mt-3 text-sm font-bold"><L id="exams.released_mark"/>{" "}{mark}</p>
				) : exam.attempts.some((a) => a.status === 'submitted') ? (
					<p className="mt-3 flex items-center gap-1 text-sm font-medium text-slate-700"><Hourglass aria-hidden className="h-4 w-4" />{" "}<L id="exams.results_have_not_been_released"/></p>
				) : null}
			</div>

			<p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><L id="exams.this_page_shows_exam_information"/></p>
		</div>
	);
}

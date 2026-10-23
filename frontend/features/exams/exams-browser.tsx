'use client';
import { L, LocalAttempts, LocalCount, LocalDuration, useLanguage } from '@/frontend/components/language-provider';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Hourglass, Lock, PlayCircle, RotateCcw, Send, type LucideIcon, FileText } from 'lucide-react';
import { filterExams, sortExams, type ExamGroup, type ExamSort } from '@/shared/exam-browse';
import type { ExamListItem, ExamListState } from '@/shared/contracts/exam-listing';
import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { EmptyState, FilterPills, SearchField, buttonClass, card, fieldClass } from '@/frontend/components/page-kit';
import { cn } from '@/shared/utils';

const STATE: Record<ExamListState, { text: string; className: string; icon: LucideIcon }> = {
	NOT_STARTED: { text: 'Not started', className: 'bg-white', icon: PlayCircle },
	IN_PROGRESS: { text: 'In progress', className: 'bg-amber-200', icon: Clock },
	TIME_EXPIRED: { text: 'Time expired', className: 'bg-rose-100', icon: AlertTriangle },
	SUBMITTED: { text: 'Submitted', className: 'bg-primary', icon: Send },
	GRADED: { text: 'Graded', className: 'bg-primary', icon: CheckCircle2 },
	NOT_OPEN_YET: { text: 'Opens later', className: 'bg-slate-100', icon: CalendarClock },
	CLOSED: { text: 'Closed', className: 'bg-slate-100', icon: Lock },
};
function StateBadge({ state }: { state: ExamListState }) {
	const { text, className, icon: Icon } = STATE[state];
	return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-black px-2.5 py-0.5 text-xs font-semibold', className)}><Icon aria-hidden className="h-3.5 w-3.5" /><L text={text} /></span>;
}
function releasedMark(exam: ExamListItem) {
	const graded = [...exam.attempts].reverse().find(a => a.status === 'graded' && a.score !== null && a.maxScore !== null);
	return graded ? `${graded.score} / ${graded.maxScore}` : null;
}

/** Search, filter and sort the exams you can see. Cards link to the same detail pages as before. */
export function ExamsBrowser({ items, isStaff }: { items: ExamListItem[]; isStaff: boolean }) {
	const { t } = useLanguage();
	const [query, setQuery] = useState(''), [group, setGroup] = useState<ExamGroup>('all'), [sort, setSort] = useState<ExamSort>('soonest'), [kind, setKind] = useState('');
	const kinds = useMemo(() => Array.from(new Set(items.map(i => i.kind))), [items]);
	const shown = useMemo(() => sortExams(filterExams(items, query, group, kind), sort), [items, query, group, sort, kind]);
	const reset = () => { setQuery(''); setGroup('all'); setKind(''); };
	return (
		<div className="space-y-5">
			{items.length > 0 && (
				<div className="flex flex-wrap items-center gap-3">
					<SearchField value={query} onChange={setQuery} label={t('eb.search_label')} placeholder={t('eb.search_ph')} />
					<FilterPills<ExamGroup> label={t('eb.filter_label')} value={group} onChange={setGroup} options={[{ value: 'all', label: <L id="eb.all" /> }, { value: 'active', label: <L id="eb.active" /> }, { value: 'upcoming', label: <L id="eb.upcoming" /> }, { value: 'finished', label: <L id="eb.finished" /> }]} />
					<div className="ms-auto flex flex-wrap items-center gap-3">
						{kinds.length > 1 && <Dropdown aria-label={t('eb.kind_label')} className={cn(fieldClass, '!w-auto min-w-[9rem] capitalize')} value={kind} onChange={e => setKind(e.target.value)}><option value="">{t('eb.kind_all')}</option>{kinds.map(k => <option key={k} value={k}>{k}</option>)}</Dropdown>}
						<label className="flex items-center gap-2 text-sm font-semibold"><L id="eb.sort_label" /><Dropdown className={cn(fieldClass, '!w-auto')} value={sort} onChange={e => setSort(e.target.value as ExamSort)}><option value="soonest">{t('eb.sort_soonest')}</option><option value="name">{t('eb.sort_name')}</option></Dropdown></label>
					</div>
				</div>
			)}
			{items.length === 0 ? (
				<EmptyState icon={<FileText className="h-8 w-8" />} title={isStaff ? <L id="exam.noneStaff" /> : <L id="exam.noneStudent" />} />
			) : shown.length === 0 ? (
				<EmptyState title={<L id="eb.no_match" />} action={<button type="button" className={buttonClass} onClick={reset}><L id="eb.clear" /></button>} />
			) : (
				<ul className="m-list grid gap-4 md:grid-cols-2">
					{shown.map(exam => {
						const mark = releasedMark(exam);
						return (
							<li key={exam.id}>
								<Link href={`/exams/${exam.id}`} className={cn(card, 'block h-full !p-5 transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2')}>
									<div className="flex items-start justify-between gap-3"><h2 dir="auto" className="font-display text-xl leading-snug">{exam.title}</h2><StateBadge state={exam.state} /></div>
									<p className="mt-1 text-xs text-slate-700">{exam.courseTitle ? `${exam.courseTitle} · ` : ''}{exam.offeringName}</p>
									{exam.instructions && <p dir="auto" className="mt-2 line-clamp-2 text-sm text-slate-700">{exam.instructions}</p>}
									<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-700">
										<span className="flex items-center gap-1"><Clock aria-hidden className="h-3.5 w-3.5" /> <LocalDuration seconds={exam.timeLimitSeconds} /></span>
										<span className="flex items-center gap-1"><RotateCcw aria-hidden className="h-3.5 w-3.5" /> <LocalAttempts count={exam.maxAttempts} /></span>
										<span>{exam.questionCount === null ? <L id="exam.countUnavailable" /> : <LocalCount count={exam.questionCount} noun="questions" />}</span>
										<span className="capitalize"><L id={`exam.kind.${exam.kind}` as 'exam.kind.exam'} /></span>
									</div>
									{exam.attempts.length > 0 && <p className="mt-3 text-xs font-medium text-slate-700"><L id="exams.attempts_started" />{' '}{exam.attempts.length}{exam.maxAttempts !== null && <L id="exam.ofLimit" values={{ count: exam.maxAttempts }} />}</p>}
									{mark && <p className="mt-2 text-sm font-bold"><L id="exams.released_mark" />{' '}{mark}</p>}
									{!isStaff && exam.state === 'SUBMITTED' && <p className="mt-2 flex items-center gap-1 text-sm font-medium text-slate-700"><Hourglass aria-hidden className="h-4 w-4" />{' '}<L id="exams.results_have_not_been_released" /></p>}
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

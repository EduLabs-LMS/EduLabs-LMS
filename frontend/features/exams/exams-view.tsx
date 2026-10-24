'use client';
import { L, Localized } from '@/frontend/components/language-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock, FileText, Loader2, RotateCcw, } from 'lucide-react';
import { TeacherFoundationNotice } from '@/frontend/components/teacher-foundation-notice';
import { api } from '@/frontend/lib/api';
import { Button } from '@/frontend/components/ui/button';
import type { ExamSummary, StudentExamState } from '@/shared/contracts/exams';
import { formatDuration } from '@/shared/exams';
import { cn } from '@/shared/utils';
interface ExamsViewProps {
    isStaff: boolean;
}
const STATE_LABEL: Record<StudentExamState, {
    text: string;
    className: string;
}> = {
    NOT_STARTED: { text: 'Not started', className: 'bg-white' },
    IN_PROGRESS: { text: 'In progress', className: 'bg-amber-200' },
    AWAITING_DECISION: { text: 'Choose next step', className: 'bg-amber-200' },
    SUBMITTED: { text: 'Submitted', className: 'bg-primary' },
    UNDER_CORRECTION: { text: 'Under Correction', className: 'bg-sky-200' },
    GRADED: { text: 'Graded', className: 'bg-primary' },
};
const cardClass = 'rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm';
export const ExamsView = ({ isStaff }: ExamsViewProps) => isStaff ? <TeacherFoundationNotice title="Exam management"/> : <StudentExamsView/>;
const StudentExamsView = () => {
    const [exams, setExams] = useState<ExamSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const requestSequence = useRef(0);
    const load = useCallback(async () => {
        const request = ++requestSequence.current;
        setIsLoading(true);
        setLoadError('');
        try {
            const res = await api.get<ExamSummary[]>('/api/exams', { timeout: 15000 });
            if (request === requestSequence.current)
                setExams(res.data);
        }
        catch {
            if (request === requestSequence.current)
                setLoadError('We could not load your exams. Please try again.');
        }
        finally {
            if (request === requestSequence.current)
                setIsLoading(false);
        }
    }, []);
    useEffect(() => {
        const requests = requestSequence;
        load();
        return () => { requests.current++; };
    }, [load]);
    return (<div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-black bg-white p-5 shadow-hard">
				<div className="flex items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-primary">
						<FileText className="h-6 w-6"/>
					</div>
					<div>
						<h1 className="font-display text-3xl leading-none"><L id="navigation.exams"/></h1>
						<p className="mt-1 text-sm text-slate-600">
							{<L id="exam.studentLegacy"/>}
						</p>
					</div>
				</div>
				{false}
			</div>

			{isLoading ? (<Localized as="div" labels={{ "aria-label": "exams.loading_exams" }} role="status" className="flex justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-slate-500"/>
				</Localized>) : loadError ? (<div role="alert" className={cn(cardClass, 'text-center')}>
					<p>{loadError}</p>
					<Button className="mt-3" variant="outline" onClick={() => void load()}><L id="exams.try_again"/></Button>
				</div>) : exams.length === 0 ? (<div className={cn(cardClass, 'text-center text-slate-600')}>
					{<L id="exam.noneLegacyStudent"/>}
				</div>) : (<div className="grid gap-4 md:grid-cols-2">
					{exams.map((exam) => (<Link key={exam.id} href={`/exams/${exam.id}`} className={cn(cardClass, 'block transition-transform hover:-translate-y-0.5')}>
								<div className="flex items-start justify-between gap-3">
									<h2 className="text-lg font-bold leading-snug">{exam.title}</h2>
									{exam.state && (<span className={cn('shrink-0 rounded-full border-2 border-black px-2.5 py-0.5 text-xs font-semibold', STATE_LABEL[exam.state].className)}>
											{STATE_LABEL[exam.state].text}
										</span>)}
								</div>
								<ExamFacts exam={exam}/>
								{exam.totalScore !== null && exam.totalScore !== undefined && (<p className="mt-3 text-sm font-bold"><L id="exams.final_mark"/>{" "}{exam.totalScore} / {exam.totalPossible}
									</p>)}
								{exam.state === 'UNDER_CORRECTION' && (<p className="mt-3 text-sm font-medium text-slate-700"><L id="exams.multiple_choice"/>{" "}{exam.mcqScore} / {exam.mcqTotal}{" "}<L id="exams.written_part_is_being_corrected"/></p>)}
							</Link>))}
				</div>)}
		</div>);
};
const ExamFacts = ({ exam }: {
    exam: ExamSummary;
}) => (<>
		{exam.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{exam.description}</p>}
		<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-700">
			<span className="flex items-center gap-1">
				<Clock className="h-3.5 w-3.5"/> {formatDuration(exam.durationMinutes)}
			</span>
			<span className="flex items-center gap-1">
				<RotateCcw className="h-3.5 w-3.5"/> {exam.maxAttempts}{" "}<L id="exams.attempt_"/>{exam.maxAttempts > 1 ? 's' : ''}
			</span>
			<span>{exam.questionCount}{" "}<L id="exams.questions"/></span>
		</div>
	</>);

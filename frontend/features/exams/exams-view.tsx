'use client';

import { L, Localized } from '@/frontend/components/language-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
	CheckCircle2,
	Clock,
	FileText,
	Hourglass,
	Loader2,
	Pencil,
	PlusCircle,
	RotateCcw,
	Trash2,
	Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { Button } from '@/frontend/components/ui/button';
import { ExamBuilder } from '@/frontend/features/exams/exam-builder';
import { ExamGradingPanel } from '@/frontend/features/exams/exam-grading-panel';
import type { ExamSummary, StudentExamState } from '@/shared/contracts/exams';
import { formatDuration } from '@/shared/exams';
import { cn } from '@/shared/utils';

interface ExamsViewProps {
	isStaff: boolean;
}

const STATE_LABEL: Record<StudentExamState, { text: string; className: string }> = {
	NOT_STARTED: { text: 'Not started', className: 'bg-white' },
	IN_PROGRESS: { text: 'In progress', className: 'bg-amber-200' },
	AWAITING_DECISION: { text: 'Choose next step', className: 'bg-amber-200' },
	SUBMITTED: { text: 'Submitted', className: 'bg-primary' },
	UNDER_CORRECTION: { text: 'Under Correction', className: 'bg-green-200' },
	GRADED: { text: 'Graded', className: 'bg-primary' },
};

const cardClass = 'rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm';

export const ExamsView = ({ isStaff }: ExamsViewProps) => {
	const [exams, setExams] = useState<ExamSummary[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const requestSequence = useRef(0);
	const [mode, setMode] = useState<
		{ type: 'list' } | { type: 'builder'; examId: string | null } | { type: 'grading'; examId: string }
	>({ type: 'list' });

	const load = useCallback(async () => {
		const request = ++requestSequence.current;
		setIsLoading(true);
		setLoadError('');
		try {
			const res = await api.get<ExamSummary[]>('/api/exams', { timeout: 15000 });
			if (request === requestSequence.current) setExams(res.data);
		} catch {
			if (request === requestSequence.current) setLoadError('We could not load your exams. Please try again.');
		} finally {
			if (request === requestSequence.current) setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		const requests = requestSequence;
		load();
		return () => { requests.current++; };
	}, [load]);

	const togglePublish = async (exam: ExamSummary) => {
		try {
			await api.patch(`/api/exams/${exam.id}`, { isPublished: !exam.isPublished });
			toast.success(exam.isPublished ? 'Exam hidden from students.' : 'Exam published.');
			load();
		} catch {
			toast.error('Could not update the exam.');
		}
	};

	const remove = async (exam: ExamSummary) => {
		if (!window.confirm(`Delete "${exam.title}" and all student attempts? This cannot be undone.`)) return;
		try {
			await api.delete(`/api/exams/${exam.id}`);
			toast.success('Exam deleted.');
			load();
		} catch {
			toast.error('Could not delete the exam.');
		}
	};

	if (mode.type === 'builder') {
		return (
			<ExamBuilder
				examId={mode.examId}
				onClose={(changed) => {
					setMode({ type: 'list' });
					if (changed) load();
				}}
			/>
		);
	}

	if (mode.type === 'grading') {
		return (
			<ExamGradingPanel
				examId={mode.examId}
				onClose={() => {
					setMode({ type: 'list' });
					load();
				}}
			/>
		);
	}

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-black bg-white p-5 shadow-hard">
				<div className="flex items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-primary">
						<FileText className="h-6 w-6" />
					</div>
					<div>
						<h1 className="font-display text-3xl leading-none"><L id="navigation.exams"/></h1>
						<p className="mt-1 text-sm text-slate-600">
							{isStaff
								? <L id="exam.staffLegacy"/>
								: <L id="exam.studentLegacy"/>}
						</p>
					</div>
				</div>
				{isStaff && (
					<Button onClick={() => setMode({ type: 'builder', examId: null })}>
						<PlusCircle className="mr-2 h-4 w-4" />{" "}<L id="exams.new_exam"/></Button>
				)}
			</div>

			{isLoading ? (
				<Localized as="div" labels={{"aria-label":"exams.loading_exams"}} role="status" className="flex justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-slate-500" />
				</Localized>
			) : loadError ? (
				<div role="alert" className={cn(cardClass, 'text-center')}>
					<p>{loadError}</p>
					<Button className="mt-3" variant="outline" onClick={() => void load()}><L id="exams.try_again"/></Button>
				</div>
			) : exams.length === 0 ? (
				<div className={cn(cardClass, 'text-center text-slate-600')}>
					{isStaff ? <L id="exam.noneLegacyStaff"/> : <L id="exam.noneLegacyStudent"/>}
				</div>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{exams.map((exam) =>
						isStaff ? (
							<div key={exam.id} className={cardClass}>
								<div className="flex items-start justify-between gap-3">
									<h2 className="text-lg font-bold leading-snug">{exam.title}</h2>
									<span
										className={cn(
											'shrink-0 rounded-full border-2 border-black px-2.5 py-0.5 text-xs font-semibold',
											exam.isPublished ? 'bg-primary' : 'bg-white'
										)}
									>
										{exam.isPublished ? <L id="common.published"/> : <L id="common.draft"/>}
									</span>
								</div>
								<ExamFacts exam={exam} />
								<div className="mt-3 flex items-center gap-4 text-xs font-medium text-slate-600">
									<span className="flex items-center gap-1">
										<Users className="h-3.5 w-3.5" /> {exam.sessionCount ?? 0}{" "}<L id="exams.students"/></span>
									{!!exam.underCorrectionCount && (
										<span className="flex items-center gap-1 text-green-900">
											<Hourglass className="h-3.5 w-3.5" /> {exam.underCorrectionCount}{" "}<L id="exams.under_correction"/></span>
									)}
								</div>
								<div className="mt-4 flex flex-wrap gap-2">
									<Button size="sm" variant="outline" onClick={() => setMode({ type: 'builder', examId: exam.id })}>
										<Pencil className="mr-1.5 h-3.5 w-3.5" />{" "}<L id="exams.edit"/></Button>
									<Button size="sm" variant="outline" onClick={() => setMode({ type: 'grading', examId: exam.id })}>
										<CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{" "}<L id="exams.written_answers"/></Button>
									<Button size="sm" variant="secondary" onClick={() => togglePublish(exam)}>
										{exam.isPublished ? <L id="common.unpublish"/> : <L id="common.publish"/>}
									</Button>
									<Localized as={Button} labels={{"aria-label":"exams.delete_exam"}} size="sm" variant="ghost" onClick={() => remove(exam)}>
										<Trash2 className="h-4 w-4 text-rose-600" />
									</Localized>
								</div>
							</div>
						) : (
							<Link key={exam.id} href={`/exams/${exam.id}`} className={cn(cardClass, 'block transition-transform hover:-translate-y-0.5')}>
								<div className="flex items-start justify-between gap-3">
									<h2 className="text-lg font-bold leading-snug">{exam.title}</h2>
									{exam.state && (
										<span
											className={cn(
												'shrink-0 rounded-full border-2 border-black px-2.5 py-0.5 text-xs font-semibold',
												STATE_LABEL[exam.state].className
											)}
										>
											{STATE_LABEL[exam.state].text}
										</span>
									)}
								</div>
								<ExamFacts exam={exam} />
								{exam.totalScore !== null && exam.totalScore !== undefined && (
									<p className="mt-3 text-sm font-bold"><L id="exams.final_mark"/>{" "}{exam.totalScore} / {exam.totalPossible}
									</p>
								)}
								{exam.state === 'UNDER_CORRECTION' && (
									<p className="mt-3 text-sm font-medium text-slate-700"><L id="exams.multiple_choice"/>{" "}{exam.mcqScore} / {exam.mcqTotal}{" "}<L id="exams.written_part_is_being_corrected"/></p>
								)}
							</Link>
						)
					)}
				</div>
			)}
		</div>
	);
};

const ExamFacts = ({ exam }: { exam: ExamSummary }) => (
	<>
		{exam.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{exam.description}</p>}
		<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-700">
			<span className="flex items-center gap-1">
				<Clock className="h-3.5 w-3.5" /> {formatDuration(exam.durationMinutes)}
			</span>
			<span className="flex items-center gap-1">
				<RotateCcw className="h-3.5 w-3.5" /> {exam.maxAttempts}{" "}<L id="exams.attempt_"/>{exam.maxAttempts > 1 ? 's' : ''}
			</span>
			<span>{exam.questionCount}{" "}<L id="exams.questions"/></span>
		</div>
	</>
);

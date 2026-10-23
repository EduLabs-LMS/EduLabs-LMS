'use client';

import { L, Localized } from '@/frontend/components/language-provider';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Hourglass, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import type { ExamResult, ExamResultQuestion } from '@/shared/contracts/exams';
import { attemptLabel, choiceLabel } from '@/shared/exams';
import { cn } from '@/shared/utils';

/** Final mark plus the visual answer history. Only rendered after the student finalised. */
export const ExamResultView = ({ examId, secure = false }: { examId: string; secure?: boolean }) => {
	const [result, setResult] = useState<ExamResult | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		(secure ? api.post<ExamResult>(`/api/secure-exams/${examId}/result`, {}) : api.get<ExamResult>(`/api/exams/${examId}/result`))
			.then((res) => setResult(res.data))
			.catch(() => toast.error('Could not load your result.'))
			.finally(() => setIsLoading(false));
	}, [examId, secure]);

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-6 w-6 animate-spin text-slate-500" />
			</div>
		);
	}
	if (!result) return null;
	if (secure) return (
		<div className="mx-auto w-full max-w-3xl space-y-5 pb-16">
			<Link href="/exams" className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-black"><ArrowLeft className="h-4 w-4" />{" "}<L id="exams.all_exams"/></Link>
			<div className="space-y-3 rounded-3xl border-2 border-black bg-white p-6 shadow-hard">
				<h1 className="font-display text-3xl leading-tight">{result.title}</h1>
				{result.resultReleased ? <p className="text-3xl font-extrabold"><L id="exams.final_mark"/>{" "}<bdi dir="ltr">{result.finalScore} / {result.finalPossible}</bdi></p> : <p className="flex items-center gap-2 text-lg font-extrabold"><Hourglass className="h-5 w-5" />{result.writtenStatus === 'UNDER_CORRECTION' ? <L id="exams.under_correction_"/> : <L id="exams.results_have_not_been_released"/>}</p>}
				{result.gradeChanges&&result.gradeChanges.length>0&&<div className="space-y-2 rounded-xl border-2 border-black bg-green-50 p-3 text-sm"><p className="font-bold"><L id="exams.grading_history"/></p>{result.gradeChanges.map(change=><p key={change.id}>{change.reason} — {change.previousScore??<L id="teacher.pending"/>} → {change.score??<L id="teacher.pending"/>} ({new Date(change.changedAt).toLocaleString()})</p>)}</div>}
                {!result.reviewReleased && <p className="text-sm text-slate-600"><L id="exams.answer_history_and_teacher_feedback"/></p>}
			</div>
			{result.reviewReleased && <><Legend />{result.questions.map(q => <ExamQuestionHistory key={q.id} question={q} />)}</>}
		</div>
	);

	const graded = result.writtenStatus === 'GRADED';
	const hasWritten = result.writtenStatus !== 'NONE';
	const total = (result.mcqScore ?? 0) + (result.writtenScore ?? 0);
	const possible = (result.mcqTotal ?? 0) + result.writtenTotal;

	return (
		<div className="mx-auto w-full max-w-3xl space-y-5 pb-16">
			<Link href="/exams" className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-black">
				<ArrowLeft className="h-4 w-4" />{" "}<L id="exams.all_exams"/></Link>

			<div className="space-y-3 rounded-3xl border-2 border-black bg-white p-6 shadow-hard">
				<h1 className="font-display text-3xl leading-tight">{result.title}</h1>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="rounded-2xl border-2 border-black bg-primary p-4">
						<p className="text-xs font-bold uppercase tracking-wider"><L id="exams.multiple_choice_"/></p>
						<p className="text-3xl font-extrabold">
							{result.mcqScore} <span className="text-lg font-semibold">/ {result.mcqTotal}</span>
						</p>
					</div>
					{hasWritten && (
						<div className={cn('rounded-2xl border-2 border-black p-4', graded ? 'bg-primary' : 'bg-green-200')}>
							<p className="text-xs font-bold uppercase tracking-wider"><L id="exams.written"/></p>
							{graded ? (
								<p className="text-3xl font-extrabold">
									{result.writtenScore} <span className="text-lg font-semibold">/ {result.writtenTotal}</span>
								</p>
							) : (
								<p className="flex items-center gap-2 pt-1 text-lg font-extrabold">
									<Hourglass className="h-5 w-5" />{" "}<L id="exams.under_correction_"/></p>
							)}
						</div>
					)}
				</div>
				{(graded || !hasWritten) && (
					<p className="text-sm font-bold"><L id="exams.final_mark"/>{" "}{total} / {possible}
					</p>
				)}
				{hasWritten && !graded && (
					<p className="text-sm text-slate-600"><L id="exams.your_written_answers_will_be"/></p>
				)}
				{result.reviewNote && (
					<div className="rounded-xl border-2 border-black bg-green-50 p-3 text-sm">
						<p className="mb-1 text-xs font-bold uppercase tracking-wider text-green-900"><L id="exams.teacher_feedback"/></p>
						<p className="whitespace-pre-wrap">{result.reviewNote}</p>
					</div>
				)}
			</div>

			<Legend />

			{result.questions.map((q) => (
				<ExamQuestionHistory key={q.id} question={q} />
			))}
		</div>
	);
};

const Legend = () => (
	<div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-black bg-white p-3 text-xs font-semibold shadow-hard-sm">
		<span className="flex items-center gap-1.5">
			<span className="h-3.5 w-3.5 rounded border-2 border-black bg-green-300" />{" "}<L id="exams.correct_answer"/></span>
		<span className="flex items-center gap-1.5">
			<span className="h-3.5 w-3.5 rounded border-2 border-black bg-rose-300" />{" "}<L id="exams.your_wrong_choice"/></span>
		<span className="flex items-center gap-1.5">
			<span className="rounded-full border-2 border-black bg-white px-1.5 text-[10px]"><L id="exams.1st_try"/></span>{" "}<L id="exams.which_attempt_you_picked_it"/></span>
	</div>
);

export const ExamQuestionHistory = ({ question: q }: { question: ExamResultQuestion }) => {
	const summary = q.picks
		.map((pick) => `${attemptLabel(pick.attemptNumber)}: ${q.questionType==='multiple_choice'?(pick.choices?.length?pick.choices.map(choiceLabel).join(', '):'No answer'):pick.choice === null||pick.choice<0 ? 'No answer' : `Choice ${choiceLabel(pick.choice)}`}`)
		.join(' · ');

	return (
		<div className="space-y-3 rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm">
			<div className="flex items-start justify-between gap-3">
				<p className="font-semibold leading-snug">
					<span className="mr-1.5 text-slate-500"><L id="homework.q"/>{q.position}.</span>
					<bdi dir="auto">{q.text}</bdi>
				</p>
				<span className="shrink-0 text-xs font-bold text-slate-600">{q.points}{" "}<L id="exams.pt"/>{q.points > 1 ? 's' : ''}</span>
			</div>
			{q.imageUrl && (
				// eslint-disable-next-line @next/next/no-img-element
				<img src={q.imageUrl} alt="" className="max-h-64 rounded-xl border-2 border-black object-contain" />
			)}

			{q.type === 'MCQ' ? (
				<>
					<div className="space-y-2">
						{(q.choices ?? []).map((choice, index) => {
							const isCorrect = q.correctChoices?.includes(index) ?? index === q.correctChoice;
							const picksHere = q.picks.filter((pick) => q.questionType==='multiple_choice'?pick.choices?.includes(index):pick.choice === index);
							const isWrongPick = !isCorrect && picksHere.length > 0;
							return (
								<div
									key={index}
									className={cn(
										'flex flex-wrap items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm',
										isCorrect && 'border-green-800 bg-green-100',
										isWrongPick && 'border-rose-600 bg-rose-100',
										!isCorrect && !isWrongPick && 'border-slate-200 bg-white'
									)}
								>
									<span
										className={cn(
											'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
											isCorrect ? 'border-emerald-700 bg-green-300' : isWrongPick ? 'border-rose-700 bg-rose-300' : 'border-slate-300'
										)}
									>
										{isCorrect ? <Check className="h-3.5 w-3.5" /> : isWrongPick ? <X className="h-3.5 w-3.5" /> : choiceLabel(index)}
									</span>
									<span className="min-w-0 flex-1 break-words">{choice}</span>
									{picksHere.map((pick) => (
										<span
											key={pick.attemptNumber}
											className={cn(
												'rounded-full border-2 border-black px-2 py-0.5 text-[11px] font-bold',
												isCorrect ? 'bg-green-300' : 'bg-rose-300'
											)}
										>
											{attemptLabel(pick.attemptNumber)}
										</span>
									))}
								</div>
							);
						})}
					</div>
					{summary && <p className="text-xs font-medium text-slate-600">{summary}</p>}
				</>
			) : (
				<div className="space-y-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-3">
					<p className="text-xs font-bold uppercase tracking-wider text-slate-600">{q.questionType==='numeric'?<L id="exam.numeric"/>:<L id="exam.written"/>}</p>
                    {q.questionType==='numeric'&&<><p className="rounded-lg border-2 border-green-800 bg-green-100 p-2 text-sm"><L id="exams.correct_answer_"/>{" "}{q.numericKey?.value}{" "}<L id="exams.tolerance"/>{q.numericKey?.absolute_tolerance})</p>{q.picks.map(pick=><p key={pick.attemptNumber} className={cn('rounded-lg border-2 p-2 text-sm',pick.value!=null&&q.numericKey&&Math.abs(pick.value-q.numericKey.value)<=q.numericKey.absolute_tolerance?'border-green-800 bg-green-100':'border-rose-600 bg-rose-100')}><strong>{attemptLabel(pick.attemptNumber)}</strong>: {pick.value??<L id="exam.noAnswer"/>}</p>)}</>}
					{q.written?.text && <p className="whitespace-pre-wrap text-sm">{q.written.text}</p>}
					{q.written?.imageUrl && (
						// eslint-disable-next-line @next/next/no-img-element
						<Localized as="img" labels={{"alt":"exams.your_handwritten_answer"}} src={q.written.imageUrl} className="max-h-72 rounded-lg border-2 border-black object-contain" />
					)}
					{!q.written?.text && !q.written?.imageUrl && <p className="text-sm italic text-slate-500"><L id="exams.no_answer_given"/></p>}
					<p className="flex items-center gap-1.5 text-sm font-bold">
						{q.writtenScore !== null ? (
							<><L id="homework.mark"/>{" "}{q.writtenScore} / {q.points}
							</>
						) : (
							<span className="inline-flex items-center gap-1.5 rounded-full border-2 border-black bg-green-200 px-2.5 py-0.5 text-xs">
								<Hourglass className="h-3.5 w-3.5" />{" "}<L id="exams.under_correction_"/></span>
						)}
					</p>
				</div>
			)}
            {q.feedback&&<p className="rounded-xl border-2 border-black bg-green-50 p-3 text-sm"><L id="exams.teacher_feedback_"/>{" "}<bdi dir="auto">{q.feedback}</bdi></p>}
		</div>
	);
};

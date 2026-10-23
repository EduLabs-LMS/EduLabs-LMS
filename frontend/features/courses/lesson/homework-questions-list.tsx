'use client';

import { BookOpen, CheckCircle2, Lock } from 'lucide-react';

import type { HomeworkQuestion } from '@/shared/contracts/courses';

interface HomeworkQuestionsListProps {
	questions: HomeworkQuestion[];
	hasSubmission: boolean;
}

/** In-app reference for textbook homework. Images are external URLs. */
const HomeworkQuestionsList = ({ questions, hasSubmission }: HomeworkQuestionsListProps) => {
	if (questions.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
				The questions for this homework have not been added yet.
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 text-base font-bold text-slate-900">
				<BookOpen className="h-5 w-5 text-green-900" />
				<span>Homework Questions ({questions.length})</span>
			</div>

			<ol className="space-y-4">
				{questions.map((question, index) => (
					<li
						key={question.id}
						className="space-y-3 rounded-xl border-2 border-black bg-white p-4 shadow-hard-sm"
					>
						<div className="flex gap-3">
							<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-600 text-xs font-bold text-white">
								{index + 1}
							</span>
							<p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
								{question.text}
							</p>
						</div>

						{question.imageUrl && (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={question.imageUrl}
								alt={`Question ${index + 1} reference`}
								loading="lazy"
								referrerPolicy="no-referrer"
								className="max-h-96 w-auto max-w-full rounded-lg border-2 border-black object-contain"
							/>
						)}

						{hasSubmission && (question.answer || question.answerImageUrl) && (
							<div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-emerald-950">
								<div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-green-900">
									<CheckCircle2 className="h-3.5 w-3.5" /> Answer
								</div>
								{question.answer && (
									<p className="whitespace-pre-wrap leading-relaxed">{question.answer}</p>
								)}
								{question.answerImageUrl && (
									// eslint-disable-next-line @next/next/no-img-element
									<img
										src={question.answerImageUrl}
										alt={`Question ${index + 1} answer`}
										loading="lazy"
										referrerPolicy="no-referrer"
										className="mt-2 max-h-80 w-auto max-w-full rounded-lg border border-green-300 object-contain"
									/>
								)}
							</div>
						)}
					</li>
				))}
			</ol>

			{!hasSubmission && (
				<p className="flex items-center gap-1.5 text-xs text-slate-500">
					<Lock className="h-3.5 w-3.5" /> Answers unlock after you submit your homework.
				</p>
			)}
		</div>
	);
};

export default HomeworkQuestionsList;

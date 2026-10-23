'use client';

import { ImageIcon, Plus, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';
import { api } from '@/frontend/lib/api';
import type { HomeworkQuestion } from '@/shared/contracts/courses';
import { MAX_QUESTIONS_PER_SEGMENT } from '@/shared/homework';
import { isValidImageUrl } from '@/shared/image-url';

interface DraftQuestion {
	key: string;
	text: string;
	imageUrl: string;
	answer: string;
	answerImageUrl: string;
}

interface HomeworkQuestionsFormProps {
	courseId: string;
	chapterId: string;
	initialQuestions: HomeworkQuestion[];
}

let counter = 0;
const newKey = () => `q-${Date.now()}-${counter++}`;
const blank = (): DraftQuestion => ({ key: newKey(), text: '', imageUrl: '', answer: '', answerImageUrl: '' });

const UrlField = ({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) => {
	const valid = !value.trim() || isValidImageUrl(value);
	return (
		<div className="space-y-1">
			<label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
				<ImageIcon className="h-3.5 w-3.5" /> {label} <span className="font-normal text-slate-400">(optional, web link)</span>
			</label>
			<Input
				type="url"
				inputMode="url"
				placeholder="https://example.com/image.png"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={valid ? '' : 'border-red-400'}
			/>
			{!valid && <p className="text-xs text-red-500">Enter a full http(s) image link.</p>}
			{value.trim() && valid && (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={value.trim()}
					alt="Preview"
					referrerPolicy="no-referrer"
					className="mt-1 max-h-32 rounded-md border-2 border-black object-contain"
				/>
			)}
		</div>
	);
};

const HomeworkQuestionsForm = ({ courseId, chapterId, initialQuestions }: HomeworkQuestionsFormProps) => {
	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();
	const [questions, setQuestions] = useState<DraftQuestion[]>(
		initialQuestions.length
			? initialQuestions.map((q) => ({
					key: q.id,
					text: q.text,
					imageUrl: q.imageUrl ?? '',
					answer: q.answer ?? '',
					answerImageUrl: q.answerImageUrl ?? '',
				}))
			: []
	);
	const [count, setCount] = useState('');

	const update = (key: string, patch: Partial<DraftQuestion>) =>
		setQuestions((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));

	const applyCount = () => {
		const target = Number(count);
		if (!Number.isInteger(target) || target < 0 || target > MAX_QUESTIONS_PER_SEGMENT) {
			toast.error(`Enter a number between 0 and ${MAX_QUESTIONS_PER_SEGMENT}.`);
			return;
		}
		setQuestions((prev) =>
			target >= prev.length
				? [...prev, ...Array.from({ length: target - prev.length }, blank)]
				: prev.slice(0, target)
		);
	};

	const onSave = async () => {
		const emptyIndex = questions.findIndex((q) => !q.text.trim());
		if (emptyIndex >= 0) {
			toast.error(`Question ${emptyIndex + 1} needs question text.`);
			return;
		}
		const badImage = questions.findIndex(
			(q) => (q.imageUrl.trim() && !isValidImageUrl(q.imageUrl)) || (q.answerImageUrl.trim() && !isValidImageUrl(q.answerImageUrl))
		);
		if (badImage >= 0) {
			toast.error(`Question ${badImage + 1} has an invalid image link.`);
			return;
		}

		try {
			startLoading('Saving questions...');
			await api.put(`/api/courses/${courseId}/chapters/${chapterId}/homework-questions`, {
				questions: questions.map(({ text, imageUrl, answer, answerImageUrl }) => ({
					text,
					imageUrl: imageUrl.trim() || null,
					answer: answer.trim() || null,
					answerImageUrl: answerImageUrl.trim() || null,
				})),
			});
			toast.success('Questions saved');
			router.refresh();
		} catch {
			toast.error('Questions could not be saved. Please try again.');
		} finally {
			stopLoading();
		}
	};

	return (
		<div className="mt-6 space-y-4 rounded-xl border-2 border-black bg-slate-50/70 p-4">
			<div className="space-y-1">
				<p className="text-sm font-semibold text-slate-900">Platform question builder</p>
				<p className="text-xs leading-relaxed text-slate-500">
					Students still work in their physical books; these questions are an in-app reference.
					Question text is required. Images (web links) and answers are optional; answers are
					shown to a student only after they submit.
				</p>
			</div>

			<div className="flex items-end gap-2">
				<div className="flex-1 space-y-1">
					<label className="text-xs font-semibold text-slate-600">Number of questions</label>
					<Input
						type="number"
						min={0}
						max={MAX_QUESTIONS_PER_SEGMENT}
						placeholder={String(questions.length)}
						value={count}
						onChange={(event) => setCount(event.target.value)}
					/>
				</div>
				<Button type="button" variant="outline" onClick={applyCount}>
					Set
				</Button>
			</div>

			<ol className="space-y-4">
				{questions.map((question, index) => (
					<li key={question.key} className="space-y-3 rounded-xl border-2 border-black bg-white p-4">
						<div className="flex items-center justify-between">
							<span className="text-xs font-bold uppercase tracking-wider text-slate-700">
								Question {index + 1}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								aria-label={`Remove question ${index + 1}`}
								onClick={() => setQuestions((prev) => prev.filter((q) => q.key !== question.key))}
							>
								<Trash2 className="h-4 w-4 text-red-500" />
							</Button>
						</div>
						<Textarea
							placeholder="Question text (required)"
							value={question.text}
							onChange={(event) => update(question.key, { text: event.target.value })}
						/>
						<UrlField
							label="Question image"
							value={question.imageUrl}
							onChange={(imageUrl) => update(question.key, { imageUrl })}
						/>
						<Textarea
							placeholder="Answer (optional)"
							value={question.answer}
							onChange={(event) => update(question.key, { answer: event.target.value })}
						/>
						<UrlField
							label="Answer image"
							value={question.answerImageUrl}
							onChange={(answerImageUrl) => update(question.key, { answerImageUrl })}
						/>
					</li>
				))}
			</ol>

			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={questions.length >= MAX_QUESTIONS_PER_SEGMENT}
					onClick={() => setQuestions((prev) => [...prev, blank()])}
				>
					<Plus className="mr-2 h-4 w-4" /> Add question
				</Button>
				<Button type="button" onClick={onSave}>
					<Save className="mr-2 h-4 w-4" /> Save questions
				</Button>
			</div>
		</div>
	);
};

export default HomeworkQuestionsForm;

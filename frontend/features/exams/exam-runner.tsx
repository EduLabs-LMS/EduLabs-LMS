'use client';

import { L, Localized } from '@/frontend/components/language-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Clock, Loader2, RotateCcw, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';

import FileUpload from '@/frontend/components/file-upload';
import { api } from '@/frontend/lib/api';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { ExamResultView } from '@/frontend/features/exams/exam-result';
import type { ExamRunQuestion, ExamRunState } from '@/shared/contracts/exams';
import {
	MAX_WRITTEN_ANSWER_TEXT,
	RETRY_PROMPT,
	attemptLabel,
	choiceLabel,
	formatDuration,
	type ExamAnswers,
} from '@/shared/exams';
import { cn } from '@/shared/utils';

const errorMessage = (error: unknown, fallback: string) => {
	const data = (error as { response?: { data?: unknown } })?.response?.data;
	if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
	return typeof data === 'string' && data ? data : fallback;
};

const formatClock = (totalSeconds: number) => {
	const s = Math.max(0, totalSeconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = String(m).padStart(2, '0');
	const ss = String(sec).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const ExamRunner = ({ examId, secure = false }: { examId: string; secure?: boolean }) => {
	const [state, setState] = useState<ExamRunState | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isBusy, setIsBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const res = secure ? await api.post<ExamRunState>(`/api/secure-exams/${examId}/state`, {}) : await api.get<ExamRunState>(`/api/exams/${examId}`);
			setState(res.data);
		} catch (error) {
			toast.error(errorMessage(error, 'Could not load the exam.'));
		} finally {
			setIsLoading(false);
		}
	}, [examId, secure]);

	useEffect(() => {
		load();
	}, [load]);

	const start = async () => {
		try {
			setIsBusy(true);
			const res = await api.post<ExamRunState>(secure ? `/api/secure-exams/${examId}/start` : `/api/exams/${examId}/start`, {});
			setState(res.data);
		} catch (error) {
			toast.error(errorMessage(error, 'Could not start the exam.'));
		} finally {
			setIsBusy(false);
		}
	};

	const decide = async (decision: 'FINALIZE' | 'RETRY') => {
		try {
			setIsBusy(true);
			await api.post(secure ? `/api/secure-exams/${examId}/decision` : `/api/exams/${examId}/decision`, { decision, ...(secure ? { revision: state?.revision } : {}) });
			await load();
		} catch (error) {
			toast.error(errorMessage(error, 'Could not continue.'));
			await load();
		} finally {
			setIsBusy(false);
		}
	};

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-6 w-6 animate-spin text-slate-500" />
			</div>
		);
	}
	if (!state) {
		return (
			<div className="mx-auto max-w-xl rounded-2xl border-2 border-black bg-white p-6 text-center shadow-hard-sm"><L id="exams.this_exam_is_not_available"/>{' '}
				<Link href="/exams" className="font-semibold underline"><L id="exams.back_to_exams_"/></Link>
			</div>
		);
	}

	if (state.status === 'FINALIZED') return <ExamResultView examId={examId} secure={secure} />;

	if (state.status === 'AWAITING_DECISION') {
		return (
			<div className="mx-auto w-full max-w-xl space-y-5 pt-6">
				<div className="space-y-5 rounded-3xl border-2 border-black bg-white p-6 shadow-hard">
					<div className="flex items-start gap-3">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-black bg-amber-200">
							<AlertTriangle className="h-5 w-5" />
						</div>
						<div>
							<h1 dir="auto" className="font-display text-2xl leading-tight">{state.exam.title}</h1>
							<p className="mt-2 text-base font-medium leading-relaxed"><L id="exam.retryPrompt"/></p>
						</div>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button variant="outline" className="flex-1" disabled={isBusy || (secure && !state.canDecide)} onClick={() => decide('FINALIZE')}><L id="exams.view_my_final_mark"/></Button>
						<Button className="flex-1" disabled={isBusy || (secure && !state.canDecide)} onClick={() => decide('RETRY')}>
							<RotateCcw className="mr-2 h-4 w-4" />{" "}<L id="exams.take_2nd_attempt"/></Button>
					</div>
					<p className="text-xs text-slate-600">
						{secure ? <L id="exam.retryExplanation"/> : <L id="exam.retryLegacy"/>}
					</p>
				</div>
			</div>
		);
	}

	if (state.status === 'NOT_STARTED') {
		return (
			<div className="mx-auto w-full max-w-xl space-y-5 pt-2">
				<Link href="/exams" className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-black">
					<ArrowLeft className="h-4 w-4" />{" "}<L id="exams.all_exams"/></Link>
				<div className="space-y-4 rounded-3xl border-2 border-black bg-white p-6 shadow-hard">
					<h1 className="font-display text-3xl leading-tight">{state.exam.title}</h1>
					{state.exam.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{state.exam.description}</p>}
					<ul className="space-y-1.5 text-sm font-medium">
						<li>• {state.exam.questionCount}{" "}<L id="exams.questions"/></li>
						<li><L id="exams.time_limit"/>{" "}{formatDuration(state.exam.durationMinutes)}{state.exam.durationMinutes !== null && ' (the timer starts when you press Start)'}</li>
						<li>
							• {state.exam.maxAttempts === 2
								? <L id="exam.twoAttempts"/>
								: <L id="exam.oneAttempt"/>}
						</li>
					</ul>
					<Button size="lg" className="w-full" disabled={isBusy || (secure && !state.canStart)} onClick={start}>
						{isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<L id="exams.start_exam"/></Button>
				</div>
			</div>
		);
	}

	return <AttemptView key={`${state.attemptId ?? state.attemptNumber}`} examId={examId} state={state} secure={secure} onFinished={load} />;
};

// ---------------------------------------------------------------------------

const AttemptView = ({
	examId,
	state,
	secure,
	onFinished,
}: {
	examId: string;
	state: ExamRunState;
	secure: boolean;
	onFinished: () => Promise<void>;
}) => {
	const [answers, setAnswers] = useState<ExamAnswers>(state.answers);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

	const answersRef = useRef(answers);
	answersRef.current = answers;
	const dirtyRef = useRef(false);
	const submittingRef = useRef(false);
	const revisionRef = useRef(state.revision ?? 0);
	const queueRef = useRef<Promise<unknown>>(Promise.resolve());
	const pendingSaveRef = useRef(0);
	const conflictRef = useRef(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const saveSecure = useCallback((snapshot: ExamAnswers, action: 'answers' | 'submit' = 'answers') => {
		pendingSaveRef.current += 1;
		const work = queueRef.current.catch(() => undefined).then(async () => {
			if (conflictRef.current) throw new Error('Exam changed in another tab. Reload before continuing.');
			const { data } = await api.post<ExamRunState>(`/api/secure-exams/${examId}/${action}`, { attemptId: state.attemptId, revision: revisionRef.current, answers: snapshot });
			revisionRef.current = data.revision ?? revisionRef.current;
			setSaveError(null);
			return data;
		}).catch(error => { if ((error as { response?: { status?: number } }).response?.status === 409) conflictRef.current = true; throw error; }).finally(() => { pendingSaveRef.current -= 1; });
		queueRef.current = work;
		return work;
	}, [examId, state.attemptId]);

	// Server clock offset so a wrong device clock can't shorten or extend the timer.
	const offsetRef = useRef(new Date(state.serverNow).getTime() - Date.now());
	const deadlineMs = state.deadline ? new Date(state.deadline).getTime() : null;

	const submit = useCallback(
		async (auto: boolean) => {
			if (submittingRef.current) return;
			submittingRef.current = true;
			setIsSubmitting(true);
			try {
				if (secure) await saveSecure(answersRef.current, 'submit');
				else await api.post(`/api/exams/${examId}/submit`, { answers: answersRef.current });
				if (auto) toast('Time is up — your answers were submitted.');
			} catch (error) {
				toast.error(errorMessage(error, 'Could not submit. Please try again.'));
			} finally {
				submittingRef.current = false;
				setIsSubmitting(false);
				await onFinished();
			}
		},
		[examId, onFinished, secure, saveSecure]
	);

	// Countdown
	useEffect(() => {
		if (deadlineMs === null) return;
		const tick = () => {
			const left = Math.ceil((deadlineMs - (Date.now() + offsetRef.current)) / 1000);
			setSecondsLeft(left);
			if (left <= 0) submit(true);
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [deadlineMs, submit]);

	// Autosave (debounced) so a refresh or lost connection doesn't lose answers.
	useEffect(() => {
		if (!dirtyRef.current) return;
		const id = setTimeout(() => {
			dirtyRef.current = false;
			const snapshot = answersRef.current;
			(secure ? saveSecure(snapshot) : api.put(`/api/exams/${examId}/answers`, { answers: snapshot })).catch((error) => {
				dirtyRef.current = true;
				setSaveError(errorMessage(error, 'Answers could not be saved. Keep this tab open and retry.'));
			});
		}, 1200);
		return () => clearTimeout(id);
	}, [answers, examId, secure, saveSecure]);

	useEffect(() => {
		if (!secure) return;
		const id = setInterval(() => {
			if (!dirtyRef.current || submittingRef.current || conflictRef.current) return;
			dirtyRef.current = false;
			saveSecure(answersRef.current).catch((error) => { dirtyRef.current = true; setSaveError(errorMessage(error, 'Answers are not saved. Please retry.')); });
		}, 5000);
		const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || pendingSaveRef.current > 0) { event.preventDefault(); event.returnValue = ''; } };
		window.addEventListener('beforeunload', warn);
		return () => { clearInterval(id); window.removeEventListener('beforeunload', warn); };
	}, [secure, saveSecure]);

	const setAnswer = (questionId: string, patch: Record<string, unknown>) => {
		dirtyRef.current = true;
		setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));
	};

	const unanswered = state.questions.filter((q) => {
		const a = answers[q.id];
		if(q.questionType==='multiple_choice')return !a?.choices?.length;
        if(q.questionType==='numeric')return typeof a?.value!=='number';
        return q.type === 'MCQ' ? typeof a?.choice !== 'number' : !a?.text?.trim() && !a?.imageUrl;
	}).length;

	const onSubmitClick = () => {
		const message = unanswered
			? `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`
			: 'Submit your answers?';
		if (window.confirm(message)) submit(false);
	};

	const warn = secondsLeft !== null && secondsLeft <= 60;

	return (
		<div className="mx-auto w-full max-w-3xl space-y-4 pb-24">
			{saveError && <p role="alert" className="rounded-xl border-2 border-black bg-rose-100 p-3 text-sm">{saveError}{" "}<L id="exams.reload_to_resolve_a_stale"/></p>}
			<div className="sticky top-2 z-30 flex items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white p-3 shadow-hard-sm md:top-4">
				<div className="min-w-0">
					<p className="truncate text-sm font-bold">{state.exam.title}</p>
					<p className="text-xs font-semibold text-slate-600">
						{attemptLabel(state.attemptNumber)}
						{state.exam.maxAttempts === 2 ? <L id="exam.ofTwo"/> : ''}
					</p>
				</div>
				<div
					className={cn(
						'flex shrink-0 items-center gap-1.5 rounded-full border-2 border-black px-3 py-1 text-sm font-extrabold tabular-nums',
						warn ? 'bg-rose-300' : 'bg-primary'
					)}
				>
					<Clock className="h-4 w-4" />
					{secondsLeft === null ? <L id="exam.unlimited"/> : formatClock(secondsLeft)}
				</div>
			</div>

			{state.questions.map((q, index) => (
				<QuestionCard
					key={q.id}
					index={index}
					question={q}
					secure={secure}
					uploadPhoto={async (file) => {
						const { data } = await api.post<{ imageKey: string; imageUrl: string }>(`/api/secure-exams/${examId}/photo`, file, { headers: { 'Content-Type': file.type, 'x-exam-attempt': state.attemptId, 'x-exam-question': q.id } });
						return data;
					}}
					answer={answers[q.id]}
					disabled={isSubmitting}
					onChange={(patch) => setAnswer(q.id, patch)}
				/>
			))}

			<div className="flex justify-end">
				<Button size="lg" disabled={isSubmitting} onClick={onSubmitClick}>
					{isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}<L id="exams.submit_answers"/></Button>
			</div>
		</div>
	);
};

const QuestionCard = ({
	index,
	question: q,
	secure,
	uploadPhoto,
	answer,
	disabled,
	onChange,
}: {
	index: number;
	question: ExamRunQuestion;
	secure: boolean;
	uploadPhoto: (file: File) => Promise<{ imageKey: string; imageUrl: string }>;
	answer?: ExamAnswers[string];
	disabled: boolean;
	onChange: (patch: Record<string, unknown>) => void;
}) => (
	<div className="space-y-3 rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm">
		<div className="flex items-start justify-between gap-3">
			<p className="font-semibold leading-snug">
				<span className="mr-1.5 text-slate-500"><L id="homework.q"/>{index + 1}.</span>
				{q.text}
			</p>
			<span className="shrink-0 text-xs font-bold text-slate-600">{q.points}{" "}<L id="exams.pt"/>{q.points > 1 ? 's' : ''}</span>
		</div>
		{q.imageUrl && (
			// eslint-disable-next-line @next/next/no-img-element
			<img src={q.imageUrl} alt="" className="max-h-64 rounded-xl border-2 border-black object-contain" />
		)}

		{q.questionType==='numeric'?<label className="block text-sm font-semibold"><L id="exams.numeric_answer"/><Input type="number" step="any" value={answer?.value??''} disabled={disabled} onChange={event=>onChange({value:event.target.value===''?null:Number(event.target.value)})} /></label>:q.type === 'MCQ' ? (
			<div className="space-y-2">
				{(q.choices ?? []).map((choice, cIndex) => {
					const selected = q.questionType==='multiple_choice' ? answer?.choices?.includes(cIndex)===true : answer?.choice === cIndex;
					return (
						<button
							key={cIndex}
							type="button"
							disabled={disabled}
							aria-pressed={selected}
                            onClick={() => q.questionType==='multiple_choice'?onChange({choices:selected?(answer?.choices??[]).filter(i=>i!==cIndex):[...(answer?.choices??[]),cIndex]}):onChange({ choice: cIndex })}
							className={cn(
								'flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-colors',
								selected ? 'border-black bg-primary font-semibold' : 'border-slate-300 bg-white hover:border-black'
							)}
						>
							<span
								className={cn(
									'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-black text-xs font-bold',
									selected ? 'bg-white' : 'bg-slate-50'
								)}
							>
								{choiceLabel(cIndex)}
							</span>
							<span className="min-w-0 break-words">{choice}</span>
						</button>
					);
				})}
			</div>
		) : (
			<div className="space-y-3">
				<Textarea
					value={answer?.text ?? ''}
					disabled={disabled}
					maxLength={MAX_WRITTEN_ANSWER_TEXT}
					onChange={(e) => onChange({ text: e.target.value })}
					placeholder={secure && !q.photoAllowed ? 'Type your written answer.' : 'Type a short answer, or upload a photo of your handwritten answer below.'}
				/>
				{answer?.imageUrl ? (
					<div className="relative inline-block">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<Localized as="img" labels={{"alt":"exams.your_handwritten_answer"}} src={answer.imageUrl} className="max-h-60 rounded-xl border-2 border-black object-contain" />
						<Localized as="button" labels={{"aria-label":"account.remove_photo"}}
							type="button"
						disabled={disabled}
							onClick={() => onChange({ imageUrl: null, imageKey: null })}
							className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-black bg-white shadow-hard-sm"
						>
							<X className="h-4 w-4" />
						</Localized>
					</div>
				) : (
					<div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-3">
						{secure ? q.photoAllowed ? <Localized as="input" labels={{"aria-label":"exams.upload_handwritten_answer"}} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={async (event) => { const file=event.target.files?.[0]; if(!file)return; event.target.value=''; if(file.size>5*1024*1024){toast.error('Photo exceeds 5 MB');return;} try{onChange(await uploadPhoto(file));}catch(error){toast.error(errorMessage(error,'Photo upload failed.'));} }} /> : <p className="text-xs text-slate-600"><L id="exams.this_question_accepts_a_typed"/></p> : <FileUpload
							endpoint="examAnswerImage"
							onChange={(url, meta) => {
								if (url) onChange({ imageUrl: url, imageKey: meta?.key ?? null });
							}}
						/>}
					</div>
				)}
			</div>
		)}
	</div>
);

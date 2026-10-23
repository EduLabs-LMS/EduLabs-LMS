'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import type { GradingEntry, GradingPayload } from '@/shared/contracts/exams';
import { cn } from '@/shared/utils';

interface ExamGradingPanelProps {
	examId: string;
	onClose: () => void;
	secure?: boolean;
}

export const ExamGradingPanel = ({ examId, onClose, secure = false }: ExamGradingPanelProps) => {
	const [data, setData] = useState<GradingPayload | null>(null);
	const [isLoading, setIsLoading] = useState(true);
 const [after,setAfter]=useState<string|null>(null),[previous,setPrevious]=useState<(string|null)[]>([]),[loadError,setLoadError]=useState(false);

	const load = useCallback(async () => {
		try {
			const res = secure ? await api.post<GradingPayload>(`/api/secure-exams/${examId}/grading`, {after}) : await api.get<GradingPayload>(`/api/exams/${examId}/grading`);
			setData(res.data);setLoadError(false);
		} catch {
			setLoadError(true);toast.error('Could not load submissions.');
		} finally {
			setIsLoading(false);
		}
	}, [examId, secure, after]);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-5 pb-12">
			<button type="button" onClick={onClose} className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-black">
				<ArrowLeft className="h-4 w-4" /> Back to exams
			</button>
			<h1 className="font-display text-3xl">{data?.exam.title ?? 'Written answers'}</h1>

			{loadError?<p role="alert" className="rounded-xl border-2 border-black bg-rose-100 p-3 text-sm">Submissions could not be loaded. Please retry.<Button onClick={load}>Retry</Button></p>:isLoading ? (
				<div className="flex justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-slate-500" />
				</div>
			) : !data || data.entries.length === 0 ? (
				<div className="rounded-2xl border-2 border-black bg-white p-6 text-center text-slate-600 shadow-hard-sm">
					No finished submissions with written questions yet.
				</div>
			) : data.writtenQuestions.length === 0 && !secure ? (
				<div className="rounded-2xl border-2 border-black bg-white p-6 text-center text-slate-600 shadow-hard-sm">
					This exam has no written questions.
				</div>
			) : (
				data.entries.map((entry) => (
					<GradingCard key={`${entry.sessionId}-${entry.revision}`} examId={examId} entry={entry} questions={data.writtenQuestions} allQuestions={data.allQuestions??data.writtenQuestions} secure={secure} onSaved={load} />
				))
			)}
            {secure&&<div className="flex justify-between gap-2"><Button variant="outline" disabled={previous.length===0||isLoading} onClick={()=>{setAfter(previous.at(-1)??null);setPrevious(p=>p.slice(0,-1));setIsLoading(true);}}>Previous submissions</Button><Button variant="outline" disabled={!data?.nextCursor||isLoading} onClick={()=>{setPrevious(p=>[...p,after]);setAfter(data?.nextCursor??null);setIsLoading(true);}}>Next submissions</Button></div>}
		</div>
	);
};

const GradingCard = ({
	examId,
	entry,
	secure,
	questions: writtenQuestions,
    allQuestions,
	onSaved,
}: {
	examId: string;
	entry: GradingEntry;
	secure: boolean;
	questions: GradingPayload['writtenQuestions'];
 allQuestions: GradingPayload['writtenQuestions'];
	onSaved: () => void;
}) => {
	const [correcting,setCorrecting]=useState(false),[reason,setReason]=useState('');
 const requestId=useRef<string|null>(null);
 const questions=correcting?allQuestions:writtenQuestions;
 const [scores, setScores] = useState<Record<string, string>>(() =>
		Object.fromEntries(allQuestions.map((q) => [q.id, entry.allScores?.[q.id] !== undefined ? String(entry.allScores[q.id]) : entry.writtenScores[q.id] !== undefined ? String(entry.writtenScores[q.id]) : '']))
	);
	const [note, setNote] = useState(entry.reviewNote ?? '');
	const [isSaving, setIsSaving] = useState(false);
	const pending = entry.writtenStatus === 'UNDER_CORRECTION';

	const save = async () => {
		if(correcting&&!reason.trim()){toast.error('Enter a reason for the correction.');return;}
        const parsed: Record<string, number> = {};
		for (const q of questions) {
			const value = scores[q.id];
			if (value === '' || value === undefined || Number.isNaN(Number(value))) {
				toast.error('Enter a mark for every written question.');
				return;
			}
			parsed[q.id] = Number(value);
		}
		try {
			setIsSaving(true);
			if (secure) await api.post(`/api/secure-exams/${examId}/grade`, { attemptId: entry.sessionId, revision: entry.revision, scores: parsed, reviewNote: note, requestId:requestId.current??(requestId.current=crypto.randomUUID()),...(correcting?{reason}: {}) });
			else await api.patch(`/api/exams/${examId}/grading/${entry.sessionId}`, { scores: parsed, reviewNote: note });
			toast.success('Marks saved.');
			onSaved();
		} catch (error) {
			const message = (error as { response?: { data?: unknown } })?.response?.data;
			toast.error(typeof message === 'string' ? message : 'Could not save marks.');
		} finally {
			setIsSaving(false);
		}
	};
	const release = async (review: boolean) => {
		try { setIsSaving(true); await api.post(`/api/secure-exams/${examId}/${review ? 'release-review' : 'release'}`, { attemptId: entry.sessionId, revision: entry.revision }); onSaved(); }
		catch { toast.error('Release is unavailable or the submission changed. Reload and retry.'); }
		finally { setIsSaving(false); }
	};

	return (
		<div className="space-y-4 rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<p className="font-bold">{entry.studentName}</p>
					<p className="text-xs text-slate-600">
						{entry.studentEmail} · MCQ {entry.mcqScore}/{entry.mcqTotal}
					</p>
				</div>
				<span className={cn('rounded-full border-2 border-black px-2.5 py-0.5 text-xs font-semibold', pending ? 'bg-green-200' : 'bg-primary')}>
					{pending ? 'Under Correction' : `Graded · ${entry.writtenScore}`}
				</span>
			</div>

			{questions.map((q) => {
				const answer = entry.answers[q.id];
				return (
					<div key={q.id} className="space-y-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-3">
						<p className="text-sm font-semibold">
							Q{q.position}. {q.text}
						</p>
						{answer?.text && <p className="whitespace-pre-wrap rounded-lg border-2 border-black bg-white p-2.5 text-sm">{answer.text}</p>}
						{answer?.imageUrl && (
							<a href={answer.imageUrl} target="_blank" rel="noreferrer" className="block">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src={answer.imageUrl} alt="Handwritten answer" className="max-h-80 rounded-lg border-2 border-black object-contain" />
								<span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
									<ExternalLink className="h-3 w-3" /> Open full size
								</span>
							</a>
						)}
						{!answer?.text && !answer?.imageUrl && <p className="text-sm italic text-slate-500">No answer given.</p>}
						<div className="flex items-center gap-2">
							<Input
								type="number"
								min={0}
								max={q.points}
								step="0.5"
								value={scores[q.id] ?? ''}
							disabled={secure && entry.resultReleased && !correcting}
								onChange={(e) => setScores((prev) => ({ ...prev, [q.id]: e.target.value }))}
								className="w-24"
							/>
							<span className="text-sm text-slate-600">/ {q.points}</span>
						</div>
					</div>
				);
			})}

            {secure&&entry.resultReleased&&<><Button variant="outline" onClick={()=>{setCorrecting(v=>!v);requestId.current=null;}}>Correct published marks</Button>{correcting&&<label className="block text-sm font-semibold">Correction reason (visible to the student)<Textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={5000} /></label>}</>}
            {entry.gradeChanges&&entry.gradeChanges.length>0&&<div className="rounded-xl border-2 border-black bg-green-50 p-3 text-sm"><p className="font-bold">Grading history</p>{entry.gradeChanges.map(c=><p key={c.id}>{c.reason}: {c.previousScore??'Pending'} → {c.score??'Pending'}</p>)}</div>}
			<Textarea value={note} disabled={secure && entry.resultReleased} onChange={(e) => setNote(e.target.value)} placeholder="Feedback for the student (optional)" />
			<Button onClick={save} disabled={isSaving || (secure && ((entry.resultReleased&&!correcting) || questions.length === 0))}>
				{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
				{correcting?'Save audited correction':pending ? 'Save marks' : 'Update marks'}
			</Button>
			{secure && <div className="flex flex-wrap gap-2"><Button disabled={isSaving || pending || entry.resultReleased} onClick={() => release(false)}>{entry.resultReleased ? 'Mark released' : 'Release final mark'}</Button><Button variant="outline" disabled={isSaving || !entry.resultReleased || entry.reviewReleased} onClick={() => release(true)}>{entry.reviewReleased ? 'Review released' : 'Release answer review'}</Button></div>}
		</div>
	);
};

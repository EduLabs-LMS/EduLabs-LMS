// Correcting homework, one student at a time: pure logic shared by the screen, the routes and the tests. No React, no I/O.
// Everything comes from homework_queue (the student lists) and get_homework with one try (the homework, its keys for staff, and the try).
// Revisions are kept exactly as the database gave them (whole numbers), never recomputed.
import { letter } from '@/shared/teacher-homework';

type Lang = 'en' | 'ar';
export type QueueTab = 'to_correct' | 'done' | 'missing';
export const QUEUE_TABS: readonly QueueTab[] = ['to_correct', 'done', 'missing'];
export const QUEUE_PAGE = 50;

/** One student's latest handed-in try in the queue (To correct and Done), or a student with nothing handed in (Missing: no submissionId). */
export type QueueRow = {
  userId: string; name: string | null; submissionId?: string; try?: number; submittedAt?: string | null; late?: boolean; waiting?: number;
  status?: string; released?: boolean; score?: number | null; revision?: number;
};
export type Queue = {
  tab: QueueTab; page: number; pageSize: number; serverNow: string; readyToRelease: number; releasable: { submissionId: string; revision: number }[];
  homework: { id: string; title: string; courseId: string; offeringId: string; lessonId: string; version: number; workflow: 'legacy' | 'questions'; mode: string; status: string;
    deadline: string | null; lateAllowed: boolean; tries: string | null; maxTries: number | null; solutionsOpen: string | null; photosAllowed: boolean; canCorrect: boolean; canRelease: boolean };
  counts: { toCorrect: number; done: number; missing: number; handedIn: number; total: number; late: number };
  rows: QueueRow[];
};

/** The try as get_homework gives it to staff. `kept`: carried from the student's last try (fix mistakes); it cannot change. */
export type TryAnswer = { questionId: string; optionIds: string[]; text: string; fileIds: string[]; kept?: boolean };
export type TryFile = { id: string; name: string; mime: string; deleted?: boolean };
export type TryMark = { questionId: string; points: number | null; feedback: string };
export type TryCorrection = { status: string; revision: number; released: boolean; score: number | null; feedback: string; marks: TryMark[] };
export type Try = { id: string; revision: number; number: number; status: 'draft' | 'submitted'; submittedAt: string | null; missedDeadline?: boolean; answers: TryAnswer[]; files: TryFile[]; correction?: TryCorrection };
export type TryQuestion = { id: string; type: 'single_choice' | 'multiple_choice' | 'essay'; text: string; imageId: string | null; points: number; responseMode: string; options: { id: string; text: string }[]; correctIds: string[]; modelAnswer: string };
export type TryView = {
  id: string; revision: number; staff: boolean; canGrade: boolean; canRelease: boolean; workflow: 'legacy' | 'questions';
  definition: { title: string; mode: string; questions: TryQuestion[]; rules?: { maxTries: number } | null };
  submissions: Try[];
};

/** A choice question as the summary shows it: the letters picked, the right letters, right or wrong, and the points. */
export type ChoiceLine = { questionId: string; n: number; picked: string[]; right: string[]; correct: boolean; points: number; max: number; kept: boolean; answered: boolean };
export function choiceSummary(view: Pick<TryView, 'definition'>, attempt: Pick<Try, 'answers' | 'correction'>, lang: Lang = 'en'): ChoiceLine[] {
  const lines: ChoiceLine[] = [];
  view.definition.questions.forEach((q, i) => {
    if (q.type === 'essay') return;
    const answer = attempt.answers.find(a => a.questionId === q.id);
    const picked = (answer?.optionIds ?? []).map(id => q.options.findIndex(o => o.id === id)).filter(n => n >= 0).sort((a, b) => a - b);
    const right = q.correctIds.map(id => q.options.findIndex(o => o.id === id)).filter(n => n >= 0).sort((a, b) => a - b);
    const correct = picked.length > 0 && picked.length === right.length && picked.every((n, k) => n === right[k]);
    const mark = attempt.correction?.marks.find(m => m.questionId === q.id);
    lines.push({ questionId: q.id, n: i + 1, picked: picked.map(n => letter(n, lang)), right: right.map(n => letter(n, lang)), correct,
      points: typeof mark?.points === 'number' ? mark.points : correct ? q.points : 0, max: q.points, kept: Boolean(answer?.kept), answered: picked.length > 0 });
  });
  return lines;
}

/** An essay as the screen shows it: the student's text and photo exactly as sent, the mark and note so far, and whether it was kept. */
export type EssayLine = { question: TryQuestion; n: number; text: string; photo: TryFile | null; kept: boolean; points: number | null; feedback: string };
export function essayLines(view: Pick<TryView, 'definition'>, attempt: Pick<Try, 'answers' | 'files' | 'correction'>): EssayLine[] {
  const out: EssayLine[] = [];
  view.definition.questions.forEach((q, i) => {
    if (q.type !== 'essay') return;
    const answer = attempt.answers.find(a => a.questionId === q.id);
    const photoId = answer?.fileIds[0];
    const mark = attempt.correction?.marks.find(m => m.questionId === q.id);
    out.push({ question: q, n: i + 1, text: answer?.text ?? '', photo: photoId ? attempt.files.find(f => f.id === photoId) ?? { id: photoId, name: '', mime: '' } : null,
      kept: Boolean(answer?.kept), points: typeof mark?.points === 'number' ? mark.points : null, feedback: mark?.feedback ?? '' });
  });
  return out;
}

/** What the teacher has typed for one try: a mark and a note per essay (kept essays are not editable), and one overall note. */
export type Draft = { marks: Record<string, { points: number | null; feedback: string }>; feedback: string };
export function draftOf(view: Pick<TryView, 'definition'>, attempt: Pick<Try, 'answers' | 'files' | 'correction'>): Draft {
  const marks: Draft['marks'] = {};
  for (const e of essayLines(view, attempt)) if (!e.kept) marks[e.question.id] = { points: e.points, feedback: e.feedback };
  return { marks, feedback: attempt.correction?.feedback ?? '' };
}
export const clampPoints = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n)));
/** Every editable essay has a mark: the try can be saved as corrected (and then released). */
export const draftComplete = (d: Draft) => Object.values(d.marks).every(m => m.points !== null);
export function draftChanged(a: Draft, b: Draft) {
  if (a.feedback !== b.feedback) return true;
  const keys = Array.from(new Set([...Object.keys(a.marks), ...Object.keys(b.marks)]));
  for (const k of keys) { const x = a.marks[k], y = b.marks[k]; if (!x || !y || x.points !== y.points || x.feedback !== y.feedback) return true; }
  return false;
}
/** The total so far: choice points as the database marked them, kept marks, and the typed essay marks (a blank essay counts nothing yet). */
export function totals(view: Pick<TryView, 'definition'>, attempt: Pick<Try, 'answers' | 'files' | 'correction'>, d: Draft) {
  let got = 0, max = 0;
  for (const c of choiceSummary(view, attempt)) { got += c.points; max += c.max; }
  for (const e of essayLines(view, attempt)) { max += e.question.points; got += e.kept ? e.points ?? 0 : d.marks[e.question.id]?.points ?? 0; }
  return { got, max };
}
/** The body of a save (the grade action). Only editable essays are sent: kept ones keep the mark they earned. A released try needs a reason. */
export function gradeBody(d: Draft, revision: number, reason: string) {
  return { action: 'grade' as const, revision, feedback: d.feedback, reason,
    marks: Object.entries(d.marks).filter(([, m]) => m.points !== null).map(([questionId, m]) => ({ questionId, points: m.points as number, feedback: m.feedback })) };
}
export const releaseBody = (revision: number, reason = '') => ({ action: 'release' as const, revision, reason });
/** A released correction changes only with a short reason (three characters or more), as the database requires. */
export const REASON_MIN = 3;
export const reasonOk = (reason: string) => reason.trim().length >= REASON_MIN;

/** Where the try stands for the teacher. */
export function tryState(attempt: Pick<Try, 'correction'>): 'waiting' | 'corrected' | 'released' {
  const c = attempt.correction;
  if (c?.released) return 'released';
  return c && c.status !== 'under_correction' && c.status !== 'submitted' && c.score !== null ? 'corrected' : 'waiting';
}
/** Release alone: a finished, not yet released correction, with the right to release. */
export const canReleaseTry = (attempt: Pick<Try, 'correction'>) => tryState(attempt) === 'corrected';

/** The next student to correct after saving: the next row of To correct, else the first one that is not this one, else none. */
export function nextStudent(rows: QueueRow[], current: string | null): QueueRow | null {
  const list = rows.filter(r => r.submissionId);
  const at = list.findIndex(r => r.submissionId === current);
  return list.slice(at + 1).find(r => r.submissionId !== current) ?? list.find(r => r.submissionId !== current) ?? null;
}
/** "Release 12 grades": exactly the queue's list, sent unchanged. */
export const releaseManyBody = (q: Pick<Queue, 'releasable'>) => ({ items: q.releasable.map(r => ({ submissionId: r.submissionId, revision: r.revision })) });

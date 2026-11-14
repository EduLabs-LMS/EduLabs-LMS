// The teacher Exams screens: pure logic shared by the page, the wizard, the correcting screen, the mark sheet, the routes and the tests.
// No React, no I/O. Times are Africa/Cairo wall times on screen and ISO 8601 with an explicit offset on the wire; a day is a Cairo day
// (YYYY-MM-DD). Revisions are kept exactly as the database gave them (whole numbers), never recomputed.
import { cairoFields, cairoIso, homeworkFailure, letter, type HomeworkFailure, type WizardQuestion } from '@/shared/teacher-homework';
import type { ExamDefinitionInput, ExamQuestionInput } from '@/shared/contracts/teacher-exams';

type Lang = 'en' | 'ar';
export type ExamKind = 'online' | 'paper';
export type ExamStatus = 'draft' | 'published' | 'archived';
export type ExamTab = 'open' | 'closed' | 'drafts' | 'archived';
export const EXAM_PORTAL_TABS: readonly ExamTab[] = ['open', 'closed', 'drafts', 'archived'];
export type Timing = 'per_group' | 'same_time';
export type ExamTries = 'one_time' | 'fix_mistakes' | 'from_zero';
export const EXAM_MAX_QUESTIONS = 100, EXAM_MAX_POINTS = 100, PAPER_MAX = 1000, TIME_LIMIT_MAX = 1440;
export type ExamFailure = HomeworkFailure;
/** The screen's reading of a reply: the same kinds as Homework (signin, denied, changed, refused, invalid, too_large, failed, unknown). */
export const examFailure = homeworkFailure;

// ---------------------------------------------------------------------------------------------------------------------------------
// Refusals: the database's codes, read once on the server
// ---------------------------------------------------------------------------------------------------------------------------------
type DatabaseError = { code?: string | null; message?: string | null; details?: string | null };
const reasonByMessage: [RegExp, string][] = [
  [/^Add a question first/, 'no_questions'], [/^Auto-release needs an exam without essays/, 'auto_release'], [/^Photo answers are off/, 'photos_off'],
  [/^Choose when the exam opens and closes/, 'no_times'], [/^Choose the starting day/, 'no_start'], [/^Choose online or paper/, 'kind'],
  [/^An exam keeps its run/, 'run'], [/^An exam keeps its kind/, 'kind_fixed'], [/^Archived exams are read only/, 'archived'], [/^Already archived/, 'archived'],
  [/^Times need an explicit offset/, 'times'], [/^Invalid time/, 'times'], [/^The new time has passed/, 'time_passed'], [/^Choose a coming time/, 'time_passed'],
  [/^Choose a coming session of this Group/, 'session'], [/^Only a draft is published/, 'not_draft'], [/^Only a published/, 'not_published'],
  [/^Publish the exam first/, 'publish_first'], [/^A released mark cannot be cleared/, 'cannot_clear'], [/^(A mark is 0 to|Marks are 0 to)/, 'mark_range'],
  [/^Finish the pending uploads/, 'uploads_pending'], [/^(At most 500|Send 1 to 500)/, 'too_many'], [/^A (grade|student) is listed twice/, 'duplicate'],
  [/^Only the latest try is marked/, 'latest'], [/^Choose a run of this course/, 'run'], [/^A paper exam/, 'paper'], [/^Online exams/, 'online'],
  [/^Question picture unavailable/, 'picture'], [/^Model answer picture unavailable/, 'model_picture'], [/^Choose the grades to release/, 'empty'],
  [/^This exam has no Group windows/, 'no_windows'], [/^Invalid marks/, 'marks'], [/^Invalid exam/, 'shape'], [/^Unsupported upload type/, 'file_type'],
];
const reasonPattern = /^[a-z_]{1,40}$/;
/**
 * HTTP status and body of a database refusal. PT409 carries its detail reason (started, window_open, still_open, unfinished, needs_time, …);
 * {"reason":"stale"} is a change made elsewhere. A 23514 carries its detail reason when it has one (reason_required, already_released,
 * unfinished), otherwise the one its message names. 23503 is a picture that is not there (or not ready). 42501 is no.
 */
export function examReply(error: DatabaseError): { status: number; body: { kind: string; reason?: string; questions?: number[] } } {
  const code = error.code ?? '', message = error.message ?? '';
  let detail: Record<string, unknown> | null = null;
  try { const parsed = JSON.parse(error.details ?? ''); detail = parsed && typeof parsed === 'object' ? parsed : null; } catch { detail = null; }
  const named = reasonByMessage.find(([pattern]) => pattern.test(message))?.[1];
  const said = typeof detail?.reason === 'string' && reasonPattern.test(detail.reason) ? detail.reason : null;
  if (code === 'PT409') {
    if (said === 'stale') return { status: 409, body: { kind: 'changed' } };
    if (said) return { status: 409, body: { kind: 'refused', reason: said } };
    return { status: 409, body: { kind: 'changed' } };
  }
  if (code === '23503') return { status: 409, body: { kind: 'refused', reason: named ?? 'in_use' } };
  if (code === '42501' || code === 'PGRST116') return { status: 403, body: { kind: 'denied' } };
  if (code === '23514' && said) {
    // Publish refusing unfinished questions lists their numbers (1 to 100) so the teacher can find them.
    const qs = detail?.questions, list = Array.isArray(qs) && qs.length > 0 && qs.length <= 100 && qs.every(n => Number.isInteger(n) && n >= 1 && n <= 100) ? qs as number[] : null;
    return { status: 400, body: said === 'unfinished_questions' && list ? { kind: 'invalid', reason: said, questions: list } : { kind: 'invalid', reason: said } };
  }
  if (code === '23514' || code === '22P02' || code === '23505' || code === '22007' || code === '22008') return { status: 400, body: named ? { kind: 'invalid', reason: named } : { kind: 'invalid' } };
  if (code === 'PT413') return { status: 413, body: { kind: 'too_large' } };
  return { status: 503, body: { kind: 'failed' } };
}
/** Every reason the routes can answer with, for the words table and its test (each one has words on screen). */
export const EXAM_REASONS = [
  'started', 'needs_time', 'reason_required', 'window_open', 'still_open', 'already_released', 'unfinished', 'unfinished_questions', 'no_window', 'not_open', 'deadline_passed', 'no_tries_left',
  ...Array.from(new Set(reasonByMessage.map(([, r]) => r))), 'in_use', 'other_space',
] as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// What the database returns
// ---------------------------------------------------------------------------------------------------------------------------------
export type GroupWindowState = 'ok' | 'cancelled' | 'needs_time';
export type PortalGroup = { groupId: string; name: string; state: GroupWindowState; opensAt: string | null; closesAt: string | null; window: 'upcoming' | 'open' | 'closed' | 'cancelled' | 'needs_time'; secondsLeft: number | null; total: number; started: number };
export type PortalRow = {
  id: string; title: string; kind: ExamKind; status: ExamStatus; courseId: string; courseTitle: string; offeringId: string; version: number;
  timing: Timing | null; startingFrom: string | null; opensAt: string | null; closesAt: string | null; heldOn: string | null; timeLimitMinutes: number | null; updatedAt: string;
  lastClose: string | null; held: boolean; questionCount: number; totalMarks: number; hasEssays: boolean;
  total: number | null; handedIn: number | null; waiting: number | null; toRelease: number | null; released: number | null;
  groups: PortalGroup[] | null; noGroup: { total: number; started: number } | null;
};
export type Portal = { tab: ExamTab; page: number; pageSize: number; serverNow: string; counts: Record<ExamTab, number>; rows: PortalRow[] };

export type ExamWindow = { groupId: string; groupName: string; source: 'auto' | 'picked' | 'custom'; sessionId: string | null; opensAt: string | null; closesAt: string | null; state: GroupWindowState; frozen: boolean };
export type StaffQuestion = {
  id: string; position: number; type: 'single_choice' | 'multiple_choice' | 'number' | 'essay'; text: string; imageId: string | null; points: number; responseMode: string;
  options: { id: string; text: string }[]; correctOptionIds: string[]; numberValue: number | null; tolerance: number; modelText: string; modelImageId: string | null;
};
export type ExamSettings = {
  id: string; familyId: string; version: number; courseId: string; offeringId: string; kind: ExamKind; title: string; description: string; status: ExamStatus; publishedAt: string | null;
  maxMarks: number | null; heldOn: string | null; timing: Timing | null; startingFrom: string | null; opensAt: string | null; closesAt: string | null; timeLimitMinutes: number | null;
  tries: ExamTries | null; shuffle: boolean; photosAllowed: boolean; autoRelease: boolean; coversAllChapters: boolean; chapterIds: string[]; questionCount: number; totalPoints: number; hasEssays: boolean;
};
export type AttemptItem = StaffQuestion & {
  answer: { optionIds: string[] | null; numberValue: number | null; text: string | null; uploadId: string | null; kept: boolean; savedAt: string } | null;
  mark: { points: number | null; auto: boolean; note: string } | null;
};
export type Attempt = { id: string; userId: string; number: number; status: 'in_progress' | 'submitted'; startedAt: string; deadlineAt: string; submittedAt: string | null; autoSubmitted: boolean; revision: number; groupId: string | null; items: AttemptItem[] };
export type ExamView = ExamSettings & {
  serverNow: string; lastClose: string | null; closed: boolean; reviewOpen: boolean; revision: number; staff: true;
  can: { author: boolean; correct: boolean; release: boolean }; started: boolean; questions: StaffQuestion[]; windows: ExamWindow[];
  holds: { groupId: string; groupName: string; state: GroupWindowState }[]; attempt?: Attempt;
};
export type QueueTab = 'to_correct' | 'corrected' | 'missing';
export const EXAM_QUEUE_TABS: readonly QueueTab[] = ['to_correct', 'corrected', 'missing'];
export type QueueRow = {
  userId: string; name: string | null; groupIds: string[]; resultId: string | null; attemptId: string | null; number: number | null; submittedAt: string | null; autoSubmitted: boolean | null;
  status: 'waiting' | 'corrected' | null; score: number | null; maxScore: number | null; waitingMarks: number | null; released: boolean; releasedAt: string | null; revision: number | null;
  windowClosed: boolean; windowClosesAt: string | null; inProgress: boolean;
};
export type Queue = {
  tab: QueueTab; page: number; pageSize: number; serverNow: string; lastClose: string | null; closed: boolean; holds: { groupId: string; groupName: string; state: string }[];
  counts: Record<QueueTab, number> & { released: number; inProgress: number }; readyToRelease: number; releasable: { resultId: string; revision: number }[]; rows: QueueRow[];
};
export type SheetRow = { userId: string; name: string | null; groupIds: string[]; resultId: string | null; mark: number | null; absent: boolean; released: boolean; releasedAt: string | null; revision: number | null };
export type Sheet = {
  page: number; pageSize: number; maxMarks: number; heldOn: string | null; status: ExamStatus; serverNow: string;
  counts: { total: number; marked: number; absent: number; released: number }; releasable: { resultId: string; revision: number }[]; groups: { id: string; name: string }[]; rows: SheetRow[];
};
/** What the page knows about each course before any exam read (the signed-in teacher's own context; the database decides again). */
export type ExamCourse = { id: string; title: string; canEdit: boolean; offerings: { id: string; name: string }[] };
export type ExamPageLoad = { state: 'ready'; courses: ExamCourse[] } | { state: 'error' };

// ---------------------------------------------------------------------------------------------------------------------------------
// Cairo days and numbers
// ---------------------------------------------------------------------------------------------------------------------------------
const dayFormats = { en: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }), ar: new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) };
/** "Sat 7 Nov" for a Cairo day (YYYY-MM-DD) that has no time. */
export const dayLabel = (day: string, lang: Lang) => dayFormats[lang].format(new Date(`${day}T12:00:00Z`)).replace(',', '');
/** Today in Cairo. */
export const cairoDate = (now: number) => cairoFields(new Date(now).toISOString()).date;
/** "2 h 05 min" style pieces: hours and minutes of a number of seconds (rounded up to the minute). */
export function timeLeft(seconds: number) { const m = Math.max(0, Math.ceil(seconds / 60)); return { hours: Math.floor(m / 60), minutes: m % 60 }; }

const DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
/**
 * A number as a teacher types it: Western, Arabic-Indic or Persian digits, a point, a comma or the Arabic decimal sign, an optional minus.
 * Null when it is not one number (empty, two separators, letters). Thousands separators are not accepted: "1,5" is one and a half.
 */
export function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/[٠-٩۰-۹]/g, d => DIGITS[d]).replace(/[٫,]/g, '.').replace(/^[−–]/, '-');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
/** A mark in halves between 0 and max, from what was typed; null for empty or not a mark. */
export function parseMark(raw: string, max: number): number | null {
  const n = parseNumber(raw);
  if (n === null || n < 0 || n > max || !Number.isInteger(n * 2)) return null;
  return n;
}
export const clampHalves = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n * 2) / 2));

// ---------------------------------------------------------------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------------------------------------------------------------
/** A question on screen: Homework's, plus Number (a right value and how far off still counts). Exams only. */
export type ExamQuestion = Omit<WizardQuestion, 'kind'> & { kind: 'choice' | 'essay' | 'number'; numberValue: string; tolerance: string };
export type ExamWizard = {
  /** `started`: a student has a try or a paper mark exists (exam_get's started): only the details save on this exam; the rest makes a new version. */
  id: string | null; revision: number | null; version: number; status: ExamStatus; started: boolean; kind: ExamKind;
  courseId: string; offeringId: string; title: string; description: string; chapterIds: string[]; coversAllChapters: boolean;
  heldOn: string; maxMarks: number;
  timing: Timing; startingFrom: string; opensDate: string; opensTime: string; closesDate: string; closesTime: string;
  limitOn: boolean; timeLimitMinutes: number; tries: ExamTries; shuffle: boolean; photos: boolean; autoRelease: boolean;
  questions: ExamQuestion[];
};
export const ONLINE_STEPS = ['details', 'questions', 'when', 'rules', 'review'] as const;
export const PAPER_STEPS = ['details', 'review'] as const;
export type ExamStep = (typeof ONLINE_STEPS)[number];
export const stepsOf = (kind: ExamKind): readonly ExamStep[] => kind === 'paper' ? PAPER_STEPS : ONLINE_STEPS;
type Ids = () => string;

export function newExamQuestion(kind: ExamQuestion['kind'], id: Ids): ExamQuestion {
  return { id: id(), kind, text: '', imageId: null, points: kind === 'essay' ? 2 : 1, options: kind === 'choice' ? Array.from({ length: 4 }, () => ({ id: id(), text: '' })) : [], correctIds: [], modelAnswer: '', modelImageId: null, numberValue: '', tolerance: '' };
}
/** Choice, Number or Essay. The question text, picture, points and model answer stay; the rest belongs to the old kind. */
export function setExamKind(q: ExamQuestion, kind: ExamQuestion['kind'], id: Ids): ExamQuestion {
  if (q.kind === kind) return q;
  const fresh = newExamQuestion(kind, id);
  return { ...fresh, id: q.id, text: q.text, imageId: q.imageId, points: q.points, modelAnswer: q.modelAnswer, modelImageId: q.modelImageId };
}
export function newExam(id: Ids, kind: ExamKind, defaults: Partial<Pick<ExamWizard, 'courseId' | 'offeringId'>> = {}): ExamWizard {
  return { id: null, revision: null, version: 1, status: 'draft', started: false, kind, courseId: '', offeringId: '', title: '', description: '', chapterIds: [], coversAllChapters: true,
    heldOn: '', maxMarks: 100, timing: 'per_group', startingFrom: '', opensDate: '', opensTime: '09:00', closesDate: '', closesTime: '10:00',
    limitOn: false, timeLimitMinutes: 60, tries: 'one_time', shuffle: false, photos: true, autoRelease: false, questions: kind === 'online' ? [newExamQuestion('choice', id)] : [], ...defaults };
}
/** The chapters chips: "All" covers every chapter (and ones added later); picking one turns All off; none picked is All again. */
export function toggleChapter(s: Pick<ExamWizard, 'chapterIds' | 'coversAllChapters'>, chapterId: string | 'all') {
  if (chapterId === 'all') return { coversAllChapters: true, chapterIds: [] as string[] };
  const ids = s.chapterIds.includes(chapterId) ? s.chapterIds.filter(c => c !== chapterId) : [...s.chapterIds, chapterId];
  return { coversAllChapters: ids.length === 0, chapterIds: ids };
}
export const hasEssays = (s: Pick<ExamWizard, 'questions'>) => s.questions.some(q => q.kind === 'essay');
export const examTotal = (s: Pick<ExamWizard, 'questions'>) => s.questions.reduce((n, q) => n + q.points, 0);
export const opensIso = (s: Pick<ExamWizard, 'opensDate' | 'opensTime'>) => s.opensDate ? cairoIso(s.opensDate, s.opensTime) : null;
export const closesIso = (s: Pick<ExamWizard, 'closesDate' | 'closesTime'>) => s.closesDate ? cairoIso(s.closesDate, s.closesTime) : null;

/**
 * The longest time limit the windows allow, in minutes: never past a window's end. Same time: the one window. In each Group's session:
 * the shortest window that has times (null while none is known yet, so nothing is capped before the windows are read).
 */
export function limitCap(s: Pick<ExamWizard, 'timing' | 'opensDate' | 'opensTime' | 'closesDate' | 'closesTime'>, windows: readonly Pick<ExamWindow, 'opensAt' | 'closesAt' | 'state'>[]): number | null {
  const minutes = (a: string, b: string) => Math.floor((Date.parse(b) - Date.parse(a)) / 60000);
  if (s.timing === 'same_time') { const a = opensIso(s), b = closesIso(s); return a && b && Date.parse(b) > Date.parse(a) ? Math.min(TIME_LIMIT_MAX, minutes(a, b)) : null; }
  const lengths = windows.filter(w => w.state === 'ok' && w.opensAt && w.closesAt).map(w => minutes(w.opensAt as string, w.closesAt as string)).filter(n => n > 0);
  return lengths.length ? Math.min(TIME_LIMIT_MAX, ...lengths) : null;
}
export const clampLimit = (n: number, cap: number | null) => Math.max(1, Math.min(cap ?? TIME_LIMIT_MAX, Math.round(n)));

/** A question ready to publish: a choice has 2 to 8 answers and a right one, a number has its value (and a tolerance of 0 or more). A draft stores it either way. */
export function questionReady(q: ExamQuestion) {
  if (q.kind === 'choice') return q.options.length >= 2 && q.options.length <= 8 && q.correctIds.length > 0;
  if (q.kind === 'number') return parseNumber(q.numberValue) !== null && (q.tolerance.trim() === '' || (parseNumber(q.tolerance) ?? -1) >= 0);
  return true;
}
/** Every question is ready to publish (a draft saves unfinished ones as they are; only a published exam needs this to save). */
export const questionsComplete = (s: Pick<ExamWizard, 'questions'>) => s.questions.every(questionReady);

export function toQuestion(q: ExamQuestion, photos: boolean): ExamQuestionInput {
  const base = { text: q.text, imageId: q.imageId, points: Math.min(EXAM_MAX_POINTS, Math.max(0, Math.round(q.points))), modelText: q.modelAnswer, modelImageId: q.modelImageId };
  if (q.kind === 'choice') return { type: 'choice', ...base, options: q.options.map(o => o.text), correct: q.options.map((o, i) => q.correctIds.includes(o.id) ? i : -1).filter(i => i >= 0) };
  if (q.kind === 'number') return { type: 'number', ...base, numberValue: parseNumber(q.numberValue), tolerance: Math.abs(parseNumber(q.tolerance) ?? 0) };
  return { type: 'essay', ...base, responseMode: photos ? 'both' : 'text' };
}
/** The keys a started exam still saves (owner's rule: only the details change once a student started or a paper mark exists). */
export const DETAIL_KEYS = ['title', 'description', 'chapterIds', 'coversAllChapters', 'heldOn'] as const;
/**
 * What exam_save receives. `kind` only when creating. Paper: details and the maximum mark. Online: details, times, rules and the questions
 * always (a draft keeps unfinished ones). Auto-release is off while there are essays.
 */
export function toExamDefinition(s: ExamWizard, opts: { create?: boolean; questions?: boolean } = {}): ExamDefinitionInput {
  const d: ExamDefinitionInput = { title: s.title.trim() || undefined, description: s.description, chapterIds: s.coversAllChapters ? [] : s.chapterIds, coversAllChapters: s.coversAllChapters };
  if (!d.title) delete d.title;
  if (opts.create) d.kind = s.kind;
  if (s.kind === 'paper') { d.heldOn = s.heldOn || null; d.maxMarks = Math.min(PAPER_MAX, Math.max(1, Math.round(s.maxMarks))); return d; }
  d.timing = s.timing;
  if (s.timing === 'per_group') d.startingFrom = s.startingFrom || null;
  else { d.opensAt = opensIso(s); d.closesAt = closesIso(s); }
  d.timeLimitMinutes = s.limitOn ? Math.max(1, Math.min(TIME_LIMIT_MAX, Math.round(s.timeLimitMinutes))) : null;
  d.tries = s.tries; d.shuffle = s.shuffle; d.photosAllowed = s.photos; d.autoRelease = s.autoRelease && !hasEssays(s);
  // Every question is always sent: a draft keeps unfinished ones (nothing is left out), a published exam is checked by the database.
  if (opts.questions !== false) d.questions = s.questions.map(q => toQuestion(q, s.photos));
  return d;
}
/** Only the detail keys of a definition (a started exam's save). */
export function detailsOnly(d: ExamDefinitionInput): ExamDefinitionInput {
  const out: ExamDefinitionInput = {};
  for (const k of DETAIL_KEYS) if (d[k] !== undefined) (out as Record<string, unknown>)[k] = d[k];
  return out;
}
/** The part of the exam a started exam cannot change here (questions, times, rules): compared to know whether a new version is needed. */
export function coreOf(s: ExamWizard) { const { title: _t, description: _d, chapterIds: _c, coversAllChapters: _a, heldOn: _h, ...rest } = toExamDefinition(s, { questions: true }); return JSON.stringify(rest); }

export function fromExamView(v: ExamView, ids: Ids): ExamWizard {
  const opens = v.opensAt ? cairoFields(v.opensAt) : null, closes = v.closesAt ? cairoFields(v.closesAt) : null;
  return {
    id: v.id, revision: v.revision, version: v.version, status: v.status, started: v.started, kind: v.kind, courseId: v.courseId, offeringId: v.offeringId,
    title: v.title, description: v.description, chapterIds: v.coversAllChapters ? [] : v.chapterIds, coversAllChapters: v.coversAllChapters,
    heldOn: v.heldOn ?? '', maxMarks: v.maxMarks ?? 100, timing: v.timing ?? 'per_group', startingFrom: v.startingFrom ?? '',
    opensDate: opens?.date ?? '', opensTime: opens?.time ?? '09:00', closesDate: closes?.date ?? '', closesTime: closes?.time ?? '10:00',
    limitOn: v.timeLimitMinutes !== null, timeLimitMinutes: v.timeLimitMinutes ?? 60, tries: v.tries ?? 'one_time', shuffle: v.shuffle, photos: v.photosAllowed, autoRelease: v.autoRelease,
    // Option ids are the database's (they change on every save, so the screen keys its rows by them only between reads).
    questions: v.questions.map(q => ({
      id: q.id || ids(), kind: q.type === 'essay' ? 'essay' : q.type === 'number' ? 'number' : 'choice', text: q.text, imageId: q.imageId, points: q.points,
      options: q.options.map(o => ({ id: o.id, text: o.text })), correctIds: q.correctOptionIds.filter(c => q.options.some(o => o.id === c)),
      modelAnswer: q.modelText, modelImageId: q.modelImageId, numberValue: q.numberValue === null ? '' : String(q.numberValue), tolerance: q.type === 'number' && q.tolerance ? String(q.tolerance) : '',
    })),
  };
}

export type ExamIssue = { step: ExamStep; key: string; question?: number };
/** What still stops a step from being complete, in order. Publishing needs every step complete; a draft saves with less. */
export function examStepIssues(s: ExamWizard, step: ExamStep, now: number, cap: number | null = null): ExamIssue[] {
  const out: ExamIssue[] = [];
  if (step === 'details') {
    if (!s.title.trim()) out.push({ step, key: 'title' });
    if (!s.courseId || !s.offeringId) out.push({ step, key: 'course' });
    if (s.kind === 'paper' && (!Number.isInteger(s.maxMarks) || s.maxMarks < 1 || s.maxMarks > PAPER_MAX)) out.push({ step, key: 'max_marks' });
  }
  if (step === 'questions' && s.kind === 'online') {
    if (!s.questions.length) out.push({ step, key: 'no_questions' });
    s.questions.forEach((q, i) => {
      if (q.kind === 'essay' && !q.text.trim()) out.push({ step, key: 'question_text', question: i });
      if (q.kind === 'choice' && !q.correctIds.length) out.push({ step, key: 'correct', question: i });
      if (q.kind === 'number' && parseNumber(q.numberValue) === null) out.push({ step, key: 'number_value', question: i });
      if (q.kind === 'number' && q.tolerance.trim() !== '' && (parseNumber(q.tolerance) ?? -1) < 0) out.push({ step, key: 'tolerance', question: i });
    });
  }
  if (step === 'when' && s.kind === 'online') {
    if (s.timing === 'per_group') { if (!s.startingFrom) out.push({ step, key: 'starting_from' }); }
    else {
      const a = opensIso(s), b = closesIso(s);
      if (!s.opensDate || !s.closesDate) out.push({ step, key: 'times' });
      else if (!a || !b) out.push({ step, key: 'times_invalid' });
      else if (Date.parse(b) <= Date.parse(a)) out.push({ step, key: 'closes_before' });
      else if (s.status === 'draft' && Date.parse(b) <= now) out.push({ step, key: 'times_past' });
    }
    if (s.limitOn && cap !== null && s.timeLimitMinutes > cap) out.push({ step, key: 'limit_long' });
  }
  if (step === 'rules' && s.kind === 'online' && s.autoRelease && hasEssays(s)) out.push({ step, key: 'auto_release' });
  return out;
}
export const examIssues = (s: ExamWizard, now: number, cap: number | null = null) => stepsOf(s.kind).filter(k => k !== 'review').flatMap(step => examStepIssues(s, step, now, cap));
/** A new exam can be created once it has a kind and a run; a saved one saves whenever the shape is valid (the title may be empty for a moment). */
export function examSavable(s: ExamWizard) {
  if (!s.offeringId) return false;
  if (s.kind === 'paper') return Number.isInteger(s.maxMarks) && s.maxMarks >= 1 && s.maxMarks <= PAPER_MAX;
  if (s.timing === 'same_time') { const a = opensIso(s), b = closesIso(s); if ((s.opensDate && !a) || (s.closesDate && !b) || (a && b && Date.parse(b) <= Date.parse(a))) return false; }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The Exams page
// ---------------------------------------------------------------------------------------------------------------------------------
export type ExamRowAction = 'edit' | 'publish' | 'unpublish' | 'archive' | 'duplicate' | 'correct' | 'marks';
/** Editors: Edit, Publish or Unpublish, Archive, Duplicate. Staff who read work: Correct (online) or Marks (paper) once published. */
export function examRowActions(row: Pick<PortalRow, 'status' | 'kind'>, canEdit: boolean): ExamRowAction[] {
  const out: ExamRowAction[] = [];
  if (row.status !== 'draft') out.push(row.kind === 'paper' ? 'marks' : 'correct');
  if (!canEdit) return out;
  if (row.status !== 'archived') out.push('edit');
  if (row.status === 'draft') out.push('publish'); else if (row.status === 'published') out.push('unpublish');
  if (row.status !== 'archived') out.push('archive');
  out.push('duplicate');
  return out;
}
/** Unpublish is refused once a student started or a mark exists: the row says so before the teacher tries. */
export const unpublishBlocked = (row: Pick<PortalRow, 'handedIn' | 'groups' | 'noGroup'>) =>
  (row.handedIn ?? 0) > 0 || (row.groups ?? []).some(g => g.started > 0) || (row.noGroup?.started ?? 0) > 0;

export type LiveCard = { examId: string; title: string; courseTitle: string; groupId: string | null; name: string | null; started: number; total: number; closesAt: string | null; secondsLeft: number | null };
/** Live now: every Group whose window is open now, from the open tab's rows (the portal's per-Group counts). */
export function liveNow(rows: readonly PortalRow[]): LiveCard[] {
  const out: LiveCard[] = [];
  for (const r of rows) {
    if (r.kind !== 'online' || r.status !== 'published' || !r.groups) continue;
    for (const g of r.groups) if (g.window === 'open') out.push({ examId: r.id, title: r.title, courseTitle: r.courseTitle, groupId: g.groupId, name: g.name, started: g.started, total: g.total, closesAt: g.closesAt, secondsLeft: g.secondsLeft });
  }
  return out.sort((a, b) => (a.secondsLeft ?? Infinity) - (b.secondsLeft ?? Infinity));
}
export type CorrectCard = { examId: string; title: string; courseTitle: string; kind: ExamKind; waiting: number; entered: number; total: number };
/** To correct: online exams with essays waiting, paper exams with marks still missing (published, counted rows only). */
export function toCorrect(rows: readonly PortalRow[]): CorrectCard[] {
  const seen = new Set<string>(), out: CorrectCard[] = [];
  for (const r of rows) {
    if (seen.has(r.id) || r.status !== 'published' || r.total === null) continue;
    seen.add(r.id);
    if (r.kind === 'online' && (r.waiting ?? 0) > 0) out.push({ examId: r.id, title: r.title, courseTitle: r.courseTitle, kind: 'online', waiting: r.waiting ?? 0, entered: r.handedIn ?? 0, total: r.total });
    if (r.kind === 'paper' && (r.handedIn ?? 0) < r.total) out.push({ examId: r.id, title: r.title, courseTitle: r.courseTitle, kind: 'paper', waiting: r.total - (r.handedIn ?? 0), entered: r.handedIn ?? 0, total: r.total });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Correcting one try (online)
// ---------------------------------------------------------------------------------------------------------------------------------
export type AutoLine = { questionId: string; n: number; type: 'choice' | 'number'; picked: string[]; right: string[]; given: string | null; correct: boolean; points: number; max: number; kept: boolean; answered: boolean };
/** Choice and number questions as the summary shows them: what the student gave, the right answer, and the points the database gave. */
export function autoLines(a: Pick<Attempt, 'items'>, lang: Lang = 'en', number: (n: number) => string = String): AutoLine[] {
  const out: AutoLine[] = [];
  a.items.forEach((q, i) => {
    if (q.type === 'essay') return;
    const points = typeof q.mark?.points === 'number' ? q.mark.points : 0;
    if (q.type === 'number') {
      const given = q.answer?.numberValue ?? null;
      const right = q.numberValue === null ? [] : [q.tolerance ? `${number(q.numberValue)} ± ${number(q.tolerance)}` : number(q.numberValue)];
      out.push({ questionId: q.id, n: i + 1, type: 'number', picked: [], right, given: given === null ? null : number(given), correct: points >= q.points && q.points > 0 ? true : given !== null && q.numberValue !== null && Math.abs(given - q.numberValue) <= q.tolerance, points, max: q.points, kept: Boolean(q.answer?.kept), answered: given !== null });
      return;
    }
    const picked = (q.answer?.optionIds ?? []).map(id => q.options.findIndex(o => o.id === id)).filter(n => n >= 0).sort((x, y) => x - y);
    const right = q.correctOptionIds.map(id => q.options.findIndex(o => o.id === id)).filter(n => n >= 0).sort((x, y) => x - y);
    const correct = picked.length > 0 && picked.length === right.length && picked.every((n, k) => n === right[k]);
    out.push({ questionId: q.id, n: i + 1, type: 'choice', picked: picked.map(n => letter(n, lang)), right: right.map(n => letter(n, lang)), given: null, correct, points, max: q.points, kept: Boolean(q.answer?.kept), answered: picked.length > 0 });
  });
  return out;
}
export type ExamEssay = { item: AttemptItem; n: number; text: string; uploadId: string | null; kept: boolean; points: number | null; note: string };
export function examEssays(a: Pick<Attempt, 'items'>): ExamEssay[] {
  const out: ExamEssay[] = [];
  a.items.forEach((q, i) => { if (q.type === 'essay') out.push({ item: q, n: i + 1, text: q.answer?.text ?? '', uploadId: q.answer?.uploadId ?? null, kept: Boolean(q.answer?.kept), points: typeof q.mark?.points === 'number' ? q.mark.points : null, note: q.mark?.note ?? '' }); });
  return out;
}
export type ExamDraft = Record<string, { points: number | null; note: string }>;
export function examDraftOf(a: Pick<Attempt, 'items'>): ExamDraft {
  const d: ExamDraft = {};
  for (const e of examEssays(a)) if (!e.kept) d[e.item.id] = { points: e.points, note: e.note };
  return d;
}
export const examDraftComplete = (d: ExamDraft) => Object.values(d).every(m => m.points !== null);
export function examDraftChanged(a: ExamDraft, b: ExamDraft) {
  for (const k of Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))) { const x = a[k], y = b[k]; if (!x || !y || x.points !== y.points || x.note !== y.note) return true; }
  return false;
}
export function examTotals(a: Pick<Attempt, 'items'>, d: ExamDraft) {
  let got = 0, max = 0;
  for (const q of a.items) { max += q.points; got += q.type === 'essay' && d[q.id] ? d[q.id].points ?? 0 : typeof q.mark?.points === 'number' ? q.mark.points : 0; }
  return { got, max };
}
/** The body of a save: the typed essay marks (in halves), with the result's revision. A released mark changes only with a reason. */
export function examGradeBody(d: ExamDraft, attemptId: string, revision: number, reason: string) {
  return { action: 'grade' as const, attemptId, revision, reason, marks: Object.entries(d).filter(([, m]) => m.points !== null).map(([questionId, m]) => ({ questionId, points: m.points as number, note: m.note })) };
}
/** Release one result: corrected, not released, and that student's window closed (no try open). The reason when it cannot. */
export function releaseBlock(row: Pick<QueueRow, 'status' | 'released' | 'windowClosed' | 'inProgress' | 'resultId'> | null, canRelease: boolean): null | 'no_right' | 'still_open' | 'unfinished' | 'released' {
  if (!row?.resultId) return 'unfinished';
  if (row.released) return 'released';
  if (!canRelease) return 'no_right';
  if (row.status !== 'corrected') return 'unfinished';
  if (!row.windowClosed || row.inProgress) return 'still_open';
  return null;
}
export function nextInQueue(rows: readonly QueueRow[], current: string | null): QueueRow | null {
  const list = rows.filter(r => r.attemptId);
  const at = list.findIndex(r => r.attemptId === current);
  return list.slice(at + 1).find(r => r.attemptId !== current) ?? list.find(r => r.attemptId !== current) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Paper marks
// ---------------------------------------------------------------------------------------------------------------------------------
/** The mark sheet as typed: what the box says, Absent, and the reason for changing a released mark. */
export type SheetEntry = { text: string; absent: boolean; reason: string };
export const entryOf = (r: SheetRow): SheetEntry => ({ text: r.mark === null ? '' : String(r.mark), absent: r.absent, reason: '' });
/** Whether what is typed differs from what is stored, and is a valid mark (empty is allowed: it clears a mark not released yet). */
export function entryState(r: SheetRow, e: SheetEntry, max: number, lang: Lang = 'en'): 'same' | 'ready' | 'invalid' | 'needs_reason' | 'cannot_clear' {
  void lang;
  const mark = e.absent ? null : e.text.trim() === '' ? null : parseMark(e.text, max);
  if (!e.absent && e.text.trim() !== '' && mark === null) return 'invalid';
  if (mark === r.mark && e.absent === r.absent) return 'same';
  if (r.released && mark === null && !e.absent) return 'cannot_clear';
  if (r.released && e.reason.trim().length < 3) return 'needs_reason';
  return 'ready';
}
export function markItem(r: SheetRow, e: SheetEntry, max: number) {
  const mark = e.absent || e.text.trim() === '' ? null : parseMark(e.text, max);
  return { userId: r.userId, mark, absent: e.absent, revision: r.revision, reason: r.released ? e.reason.trim() : '' };
}
/** The students of one Group ('all', a Group id, or 'none' = in no Group), from every row of the sheet. */
export function sheetRows(rows: readonly SheetRow[], group: string): SheetRow[] {
  if (group === 'all') return rows.slice();
  if (group === 'none') return rows.filter(r => !r.groupIds.length);
  return rows.filter(r => r.groupIds.includes(group));
}
export const enteredCount = (rows: readonly SheetRow[]) => rows.filter(r => r.mark !== null || r.absent).length;
/** "Release marks": every entered mark (or Absent) not released yet, with its revision as the sheet now holds it. */
export const sheetReleasable = (rows: readonly SheetRow[]) => rows.filter(r => r.resultId && !r.released && (r.mark !== null || r.absent)).map(r => ({ resultId: r.resultId as string, revision: r.revision as number }));

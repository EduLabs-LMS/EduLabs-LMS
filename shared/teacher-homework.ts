// The teacher Homework screens: pure logic shared by the page, the wizard, the routes and the tests. No React, no I/O.
// Times are Africa/Cairo wall times on screen and ISO 8601 with an explicit offset on the wire. Versions (revision, updatedAt) are kept
// exactly as the database gave them: a revision is a whole number, a timestamp is the string it came as, never a JS Date.

export const CAIRO = 'Africa/Cairo';
export type Tries = 'one_time' | 'fix_mistakes' | 'from_zero';
export type SolutionsOpen = 'after_hand_in' | 'after_deadline';
export type PortalTab = 'open' | 'closed' | 'drafts';
export const PORTAL_TABS: readonly PortalTab[] = ['open', 'closed', 'drafts'];
export const MIN_TRIES = 2, MAX_TRIES = 10, MAX_QUESTIONS = 100, MAX_OPTIONS = 8, MIN_OPTIONS = 2, MAX_MARKS = 100;
export const PHOTO_LIMIT_BYTES = 5 * 1024 * 1024;
/** Answer letters: A to H in English, the abjad order in Arabic. Never numbers. */
const LETTERS = { en: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], ar: ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'] } as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Cairo time
// ---------------------------------------------------------------------------------------------------------------------------------
const wallFormat = new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** The Cairo date (YYYY-MM-DD) and time (HH:MM) of an instant, as a date and a time field expect them. */
export function cairoFields(iso: string): { date: string; time: string } {
  const parts = wallFormat.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour') === '24' ? '00' : part('hour')}:${part('minute')}` };
}
/**
 * A Cairo wall time as ISO 8601 with Cairo's offset at that moment ("2026-11-07T23:59:00+02:00"), whatever the browser's own zone.
 * Null for a malformed value or a time that does not exist in Cairo (the spring-forward hour). In the autumn fold the later instant is
 * taken, as PostgreSQL does.
 */
export function cairoIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall)) return null;
  const fits = [2, 3].filter(h => { const f = cairoFields(new Date(wall - h * 3600000).toISOString()); return f.date === date && f.time === time; });
  if (!fits.length) return null;
  const hours = Math.min(...fits); // the smaller offset is the later instant
  return `${date}T${time}:00+0${hours}:00`;
}
/** Today in Cairo, for the smallest date a deadline field offers. */
export const cairoToday = (now: number) => cairoFields(new Date(now).toISOString()).date;
/** The deadline must be in the future (for a change of deadline the database says the same). */
export function deadlineInFuture(iso: string | null, now: number) { return iso !== null && Date.parse(iso) > now; }

const dayFormats = { en: new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO, weekday: 'short', day: 'numeric', month: 'short' }), ar: new Intl.DateTimeFormat('ar-EG', { timeZone: CAIRO, weekday: 'short', day: 'numeric', month: 'short' }) };
const timeFormats = { en: new Intl.DateTimeFormat('en-US', { timeZone: CAIRO, hour: 'numeric', minute: '2-digit', hour12: true }), ar: new Intl.DateTimeFormat('ar-EG', { timeZone: CAIRO, hour: 'numeric', minute: '2-digit', hour12: true }) };
type Lang = 'en' | 'ar';
/** "Sat 7 Nov" (Cairo). */
export const cairoDay = (iso: string, lang: Lang) => dayFormats[lang].format(new Date(iso)).replace(',', '');
/** "11:59 PM" (Cairo). */
export const cairoTime = (iso: string, lang: Lang) => timeFormats[lang].format(new Date(iso));
/** The teacher's week, Saturday to Friday in Cairo: the database gives its start and the next Saturday; the screen shows the Friday. */
export function weekRange(weekStart: string, weekEnd: string, lang: Lang) {
  return { from: cairoDay(weekStart, lang), to: cairoDay(new Date(Date.parse(weekEnd) - 12 * 3600000).toISOString(), lang) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The page read (homework_portal)
// ---------------------------------------------------------------------------------------------------------------------------------
export type PortalRow = {
  id: string; title: string; courseId: string; courseTitle: string; offeringId: string; lessonId: string; lessonTitle: string; version: number;
  workflow: 'legacy' | 'questions'; mode: string; status: 'draft' | 'published'; deadline: string | null; lateAllowed: boolean; tries: Tries; maxTries: number;
  solutionsOpen: SolutionsOpen; photosAllowed: boolean; updatedAt: string; questionCount: number; totalMarks: number;
  handedIn: number | null; total: number | null; late: number | null; waiting: number | null; imageBytes: number | null;
};
export type Portal = {
  tab: PortalTab; page: number; pageSize: number; serverNow: string;
  stats: { weekStart: string; weekEnd: string; essaysWaiting: number; correctedThisWeek: number; handedInThisWeek: number; onTimePercent: number | null };
  counts: Record<PortalTab, number>; toCorrect: PortalRow[]; rows: PortalRow[];
};
/** What the page knows about each course before any homework read (from the signed-in teacher's own context; the database decides again). */
/** `spaceId`: the teaching space (organization) the course belongs to; a homework never moves out of its space. */
export type HomeworkCourse = { id: string; spaceId: string; title: string; status: string; canEdit: boolean; offerings: { id: string; name: string; canManage: boolean }[] };
export type HomeworkPageLoad = { state: 'ready'; courses: HomeworkCourse[] } | { state: 'error' };

export const pageCount = (count: number, size: number) => Math.max(1, Math.ceil(count / size));
/** "1.4 MB", "820 KB", in the page's digits. */
export function storageSize(bytes: number, number: (n: number) => string): { value: string; unit: 'mb' | 'kb' } {
  if (bytes >= 1024 * 1024) return { value: number(Math.round(bytes / 104857.6) / 10), unit: 'mb' };
  return { value: number(Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))), unit: 'kb' };
}
/** Which row actions a row offers. Editors: Edit, Change deadline, Publish/Unpublish. Managers of a closed homework: Delete images. */
export function rowActions(row: Pick<PortalRow, 'status' | 'deadline' | 'workflow'>, tab: PortalTab, canEdit: boolean, canManage: boolean) {
  const actions: ('edit' | 'deadline' | 'publish' | 'unpublish' | 'delete_images')[] = [];
  if (canEdit) actions.push('edit');
  if (canEdit && row.workflow === 'questions' && tab !== 'drafts') actions.push('deadline');
  if (canEdit) actions.push(row.status === 'draft' ? 'publish' : 'unpublish');
  if (canManage && tab === 'closed') actions.push('delete_images');
  return actions;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Refusals: the database's codes, read once on the server and once on the screen
// ---------------------------------------------------------------------------------------------------------------------------------
type DatabaseError = { code?: string | null; message?: string | null; details?: string | null };
const reasonByMessage: [RegExp, string][] = [
  [/^Work has started/, 'started'], [/^Set a deadline/, 'no_deadline'], [/^The new deadline must be in the future/, 'deadline_past'],
  [/^Photo answers are off/, 'photos_off'], [/^A model answer picture/, 'model_image'], [/^A homework stays in its teaching space/, 'other_space'], [/^Complete question keys/, 'keys'], [/^Tries must be/, 'tries'],
  [/^Finish (cloned|this version|original)/, 'media'], [/^Only new homework has a deadline/, 'legacy'],
];
/**
 * HTTP status and body of a database refusal. PT409 carries its detail reason when it has one (deadline_passed, no_tries_left, still_open, and
 * for a refused move started or versioned).
 */
export function homeworkReply(error: DatabaseError): { status: number; body: { kind: string; reason?: string } } {
  const code = error.code ?? '', message = error.message ?? '';
  let detail: Record<string, unknown> | null = null;
  try { const parsed = JSON.parse(error.details ?? ''); detail = parsed && typeof parsed === 'object' ? parsed : null; } catch { detail = null; }
  const named = reasonByMessage.find(([pattern]) => pattern.test(message))?.[1];
  if (code === 'PT409') {
    if (typeof detail?.reason === 'string' && /^[a-z_]{1,40}$/.test(detail.reason)) return { status: 409, body: { kind: 'refused', reason: detail.reason } };
    return named === 'started' ? { status: 409, body: { kind: 'refused', reason: 'started' } } : { status: 409, body: { kind: 'changed' } };
  }
  if (code === '23503') return { status: 409, body: { kind: 'refused', reason: 'in_use' } };
  if (code === '42501' || code === 'PGRST116') return { status: 403, body: { kind: 'denied' } };
  if (code === '23514' || code === '22P02' || code === '23505') return { status: 400, body: named ? { kind: 'invalid', reason: named } : { kind: 'invalid' } };
  if (code === 'PT413') return { status: 413, body: { kind: 'too_large' } };
  return { status: 503, body: { kind: 'failed' } };
}
export type HomeworkFailure = { kind: 'signin' | 'denied' | 'changed' | 'too_large' | 'failed' | 'unknown' } | { kind: 'refused' | 'invalid'; reason: string | null };
/** The screen's reading of a reply. No reply (`status` null) is an unknown outcome: it may have been saved. */
export function homeworkFailure(status: number | null, body: unknown): HomeworkFailure {
  const reason = body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string' ? (body as { reason: string }).reason : null;
  if (status === null) return { kind: 'unknown' };
  if (status === 401) return { kind: 'signin' };
  if (status === 403 || status === 404) return { kind: 'denied' };
  if (status === 409) return (body as { kind?: unknown } | null)?.kind === 'refused' ? { kind: 'refused', reason } : { kind: 'changed' };
  if (status === 413) return { kind: 'too_large' };
  if (status === 400 || status === 415) return { kind: 'invalid', reason };
  return { kind: 'failed' };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * A question on screen. A choice question has 2 to 8 answers, each with optional text, and the teacher marks every right one: one right
 * answer is single choice, more than one is multiple choice (derived, never chosen). Its question text is optional too. An essay may have a
 * model answer text and a choice an explanation; either may carry a model answer picture. Students see them when the solutions open.
 */
export type WizardQuestion = {
  id: string; kind: 'choice' | 'essay'; text: string; imageId: string | null; points: number;
  options: { id: string; text: string }[]; correctIds: string[]; modelAnswer: string; modelImageId: string | null;
};
export type WizardState = {
  /** `locked`: a student has a try (get_homework's locked). `version` above 1: a later version. Either keeps course and lesson where they are. */
  id: string | null; revision: number | null; version: number; status: 'draft' | 'published'; locked: boolean;
  courseId: string; offeringId: string; lessonId: string; title: string; instructions: string;
  questions: WizardQuestion[]; photos: boolean;
  deadlineDate: string; deadlineTime: string; lateAllowed: boolean; tries: Tries; maxTries: number;
  solutionsOpen: SolutionsOpen; solutionText: string; solutionVideoId: string | null; solutionIds: string[]; referenceIds: string[];
};
export const WIZARD_STEPS = ['details', 'questions', 'rules', 'solutions', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
type Ids = () => string;

/** A new choice question starts with four blank answers, A to D. */
export function newQuestion(kind: 'choice' | 'essay', id: Ids): WizardQuestion {
  return { id: id(), kind, text: '', imageId: null, points: kind === 'essay' ? 2 : 1, options: kind === 'choice' ? Array.from({ length: 4 }, () => ({ id: id(), text: '' })) : [], correctIds: [], modelAnswer: '', modelImageId: null };
}
export function newWizard(id: Ids, defaults: Partial<Pick<WizardState, 'courseId' | 'offeringId' | 'lessonId'>> = {}): WizardState {
  return { id: null, revision: null, version: 1, status: 'draft', locked: false, courseId: '', offeringId: '', lessonId: '', title: '', instructions: '', questions: [newQuestion('choice', id)], photos: true,
    deadlineDate: '', deadlineTime: '23:59', lateAllowed: false, tries: 'one_time', maxTries: 2, solutionsOpen: 'after_hand_in', solutionText: '', solutionVideoId: null, solutionIds: [], referenceIds: [], ...defaults };
}
/** Choice or Essay. A choice keeps nothing of an essay and the other way round, except the question text and picture. */
export function setKind(q: WizardQuestion, kind: 'choice' | 'essay', id: Ids): WizardQuestion {
  if (q.kind === kind) return q;
  const fresh = newQuestion(kind, id);
  return { ...fresh, id: q.id, text: q.text, imageId: q.imageId, points: q.points, modelAnswer: q.modelAnswer, modelImageId: q.modelImageId };
}
/** Single choice with one right answer (or none yet), multiple choice with more than one. What students are told follows from it. */
export const choiceType = (q: Pick<WizardQuestion, 'correctIds'>) => q.correctIds.length > 1 ? 'multiple_choice' as const : 'single_choice' as const;
/** Every answer text is empty: the screen shows the answers as a row of letters. */
export const blankAnswers = (q: Pick<WizardQuestion, 'options'>) => q.options.every(o => !o.text.trim());
/** Tap an answer to mark it right, tap it again to unmark it. Any number of answers may be right. */
export function toggleCorrect(q: WizardQuestion, optionId: string): WizardQuestion {
  if (!q.options.some(o => o.id === optionId)) return q;
  return { ...q, correctIds: q.correctIds.includes(optionId) ? q.correctIds.filter(c => c !== optionId) : [...q.correctIds, optionId] };
}
export function addOption(q: WizardQuestion, id: Ids): WizardQuestion {
  return q.kind !== 'choice' || q.options.length >= MAX_OPTIONS ? q : { ...q, options: [...q.options, { id: id(), text: '' }] };
}
export function removeOption(q: WizardQuestion, optionId: string): WizardQuestion {
  return q.kind !== 'choice' || q.options.length <= MIN_OPTIONS ? q : { ...q, options: q.options.filter(o => o.id !== optionId), correctIds: q.correctIds.filter(c => c !== optionId) };
}
export const clampMarks = (n: number) => Math.min(MAX_MARKS, Math.max(0, Math.round(n)));
export const clampTries = (n: number) => Math.min(MAX_TRIES, Math.max(MIN_TRIES, Math.round(n)));
export function moveQuestion(list: WizardQuestion[], from: number, to: number) {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = list.slice(); const [row] = next.splice(from, 1); next.splice(to, 0, row); return next;
}
export const totalMarks = (state: Pick<WizardState, 'questions'>) => state.questions.reduce((n, q) => n + q.points, 0);
/** The letter of the answer at position i (0 to 7). */
export const letter = (i: number, lang: Lang = 'en') => LETTERS[lang][Math.max(0, Math.min(MAX_OPTIONS - 1, i))];

/** Course and lesson are fixed once a student has started (locked) or for a later version; until then a saved homework may move. */
export const placeLocked = (s: Pick<WizardState, 'locked' | 'version'>) => s.locked || s.version > 1;
/**
 * The courses a homework may be placed in: any of the given ones while it is new; once saved, only those of its own teaching space (the
 * owner's rule: a move never leaves its space; the route and the database refuse it with {"reason":"other_space"} anyway).
 */
export function placeCourses<C extends Pick<HomeworkCourse, 'id' | 'spaceId'>>(courses: C[], all: readonly Pick<HomeworkCourse, 'id' | 'spaceId'>[], s: Pick<WizardState, 'id' | 'courseId'>): C[] {
  if (!s.id) return courses;
  const space = all.find(c => c.id === s.courseId)?.spaceId;
  return courses.filter(c => space ? c.spaceId === space : c.id === s.courseId);
}
/** Choosing another course empties the lesson (it belongs to the old course); another run of the same course keeps it. */
export function chooseCourse(s: WizardState, courseId: string, offeringId: string): WizardState {
  if (placeLocked(s)) return s;
  return { ...s, courseId, offeringId, lessonId: s.courseId === courseId ? s.lessonId : '' };
}

/** The deadline the wizard will send: ISO with Cairo's offset, or null while the date is empty or impossible. */
export const wizardDeadline = (s: Pick<WizardState, 'deadlineDate' | 'deadlineTime'>) => s.deadlineDate ? cairoIso(s.deadlineDate, s.deadlineTime) : null;

export type Issue = { step: WizardStep; key: string; question?: number };
/** What still stops a step from being complete, in order. Publishing needs every step complete; a draft saves with less. */
export function stepIssues(s: WizardState, step: WizardStep, now: number): Issue[] {
  const out: Issue[] = [];
  if (step === 'details') {
    if (!s.title.trim()) out.push({ step, key: 'title' });
    if (!s.courseId || !s.offeringId) out.push({ step, key: 'course' });
    if (!s.lessonId) out.push({ step, key: 'lesson' });
  }
  if (step === 'questions') {
    if (!s.questions.length) out.push({ step, key: 'no_questions' });
    s.questions.forEach((q, i) => {
      if (q.kind === 'essay') { if (!q.text.trim()) out.push({ step, key: 'question_text', question: i }); return; }
      // A choice question's text and answer texts are optional (the question may be in the book); it needs a right answer.
      if (!q.correctIds.length) out.push({ step, key: 'correct', question: i });
    });
  }
  if (step === 'rules') {
    const deadline = wizardDeadline(s);
    if (!s.deadlineDate) out.push({ step, key: 'deadline' });
    else if (!deadline) out.push({ step, key: 'deadline_invalid' });
    else if (s.status === 'draft' && !deadlineInFuture(deadline, now)) out.push({ step, key: 'deadline_past' });
    if (s.tries !== 'one_time' && (s.maxTries < MIN_TRIES || s.maxTries > MAX_TRIES)) out.push({ step, key: 'tries' });
  }
  return out;
}
export const allIssues = (s: WizardState, now: number) => (['details', 'questions', 'rules', 'solutions'] as const).flatMap(step => stepIssues(s, step, now));

/** A draft can be stored once it has a title, a course and a lesson, and its questions have a shape the database accepts. */
export function draftSavable(s: WizardState) {
  if (!s.title.trim() || !s.offeringId || !s.lessonId || !s.questions.length) return false;
  if (s.deadlineDate && !wizardDeadline(s)) return false;
  return s.questions.every(q => q.kind === 'essay' || (q.options.length >= MIN_OPTIONS && q.options.length <= MAX_OPTIONS));
}

/** What save_homework receives. Photos off makes every essay text only; one time is one try; the deadline carries its offset. */
export function toDefinition(s: WizardState, published: boolean) {
  return {
    title: s.title.trim(), instructions: s.instructions, mode: 'PLATFORM_QUESTIONS' as const, published, usesMarks: true, filePoints: 0,
    questions: s.questions.map(q => ({
      id: q.id, type: q.kind === 'essay' ? 'essay' as const : choiceType(q),
      text: q.text, imageId: q.imageId, points: clampMarks(q.points), responseMode: q.kind === 'essay' ? (s.photos ? 'both' as const : 'text' as const) : 'text' as const,
      options: q.kind === 'essay' ? [] : q.options.map(o => ({ id: o.id, text: o.text })),
      correctIds: q.kind === 'essay' ? [] : q.correctIds, modelAnswer: q.modelAnswer, modelImageId: q.modelImageId,
    })),
    modelAnswer: s.solutionText, solutionVideo: '', solutionVideoId: s.solutionVideoId, referenceIds: s.referenceIds, solutionIds: s.solutionIds,
    rules: { deadline: wizardDeadline(s), lateAllowed: s.lateAllowed, tries: s.tries, maxTries: s.tries === 'one_time' ? 1 : clampTries(s.maxTries), solutionsOpen: s.solutionsOpen, photosAllowed: s.photos },
  };
}
export type WizardDefinition = ReturnType<typeof toDefinition>;

/** One homework as get_homework returns it, for the teacher (staff) reading it back into the wizard. */
export type TeacherHomeworkView = {
  id: string; offeringId: string; lessonId: string; segmentId: string | null; revision: number; version: number; locked: boolean; staff: boolean; canManage: boolean;
  workflow: 'legacy' | 'questions'; deadline: string | null;
  definition: {
    title: string; instructions: string; mode: string; published: boolean; modelAnswer: string; solutionVideoId: string | null; referenceIds: string[]; solutionIds: string[];
    questions: { id: string; type: 'single_choice' | 'multiple_choice' | 'essay'; text: string; imageId: string | null; points: number; responseMode: string; options: { id: string; text: string }[]; correctIds: string[]; modelAnswer: string; modelImageId?: string | null }[];
    rules?: { deadline: string | null; lateAllowed: boolean; tries: Tries; maxTries: number; solutionsOpen: SolutionsOpen; photosAllowed: boolean };
  };
};
export function fromView(v: TeacherHomeworkView, courseId: string): WizardState {
  const d = v.definition, r = d.rules, at = r?.deadline ? cairoFields(r.deadline) : null;
  return {
    id: v.id, revision: v.revision, version: v.version, status: d.published ? 'published' : 'draft', locked: v.locked, courseId, offeringId: v.offeringId, lessonId: v.lessonId,
    title: d.title, instructions: d.instructions,
    questions: d.questions.map(q => ({ id: q.id, kind: q.type === 'essay' ? 'essay' : 'choice',
      text: q.text, imageId: q.imageId, points: q.points, options: q.options, correctIds: q.correctIds, modelAnswer: q.modelAnswer, modelImageId: q.modelImageId ?? null })),
    photos: r?.photosAllowed ?? true, deadlineDate: at?.date ?? '', deadlineTime: at?.time ?? '23:59', lateAllowed: r?.lateAllowed ?? false,
    tries: r?.tries ?? 'one_time', maxTries: r && r.tries !== 'one_time' ? r.maxTries : 2, solutionsOpen: r?.solutionsOpen ?? 'after_hand_in',
    solutionText: d.modelAnswer, solutionVideoId: d.solutionVideoId, solutionIds: d.solutionIds, referenceIds: d.referenceIds,
  };
}
/** The plain rule for when solutions open (DECISIONS.md, "Homework and course content"). */
export function solutionsRule(s: Pick<WizardState, 'solutionsOpen' | 'tries' | 'maxTries'>): 'after_hand_in' | 'after_last_try' | 'after_deadline' {
  if (s.solutionsOpen === 'after_deadline') return 'after_deadline';
  return s.tries === 'one_time' ? 'after_hand_in' : 'after_last_try';
}

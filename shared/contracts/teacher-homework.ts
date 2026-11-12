import { z } from 'zod';

/**
 * What the teacher Homework routes accept. Strict everywhere: an unknown key is refused. The caller is never named here (the server takes
 * the signed-in identity); revisions are whole numbers compared by the database; a deadline is ISO 8601 with an explicit offset, the same
 * pattern save_homework and homework_lifecycle check.
 */
const id = z.string().uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const deadlinePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const deadline = z.string().max(40).regex(deadlinePattern).refine(v => Number.isFinite(Date.parse(v)));
const page = z.coerce.number().int().min(0).max(100000);

/** The page read: ?course=<id> (or none for every course), ?tab=open|closed|drafts, ?page=n. */
export const portalQuery = z.object({ course: id.optional(), tab: z.enum(['open', 'closed', 'drafts']).default('open'), page: page.default(0) }).strict();

const option = z.object({ id, text: z.string().max(2000) }).strict();
const question = z.object({
  id, type: z.enum(['single_choice', 'multiple_choice', 'essay']), text: z.string().max(10000), imageId: id.nullable(), points: z.number().int().min(0).max(100),
  responseMode: z.enum(['text', 'both']), options: z.array(option).max(8), correctIds: z.array(id).max(8), modelAnswer: z.string().max(10000),
  // The model answer picture, shown to students only when the solutions open for them. Absent means none.
  modelImageId: id.nullable().default(null),
}).strict().superRefine((q, c) => {
  if (new Set(q.options.map(o => o.id)).size !== q.options.length) c.addIssue({ code: 'custom', message: 'option ids' });
  if (q.type === 'essay') { if (q.options.length || q.correctIds.length) c.addIssue({ code: 'custom', message: 'essay has no options' }); return; }
  if (q.responseMode !== 'text') c.addIssue({ code: 'custom', message: 'a choice is answered by choosing' });
  if (q.options.length < 2 || new Set(q.correctIds).size !== q.correctIds.length || q.correctIds.some(v => !q.options.some(o => o.id === v)) || (q.type === 'single_choice' && q.correctIds.length > 1)) c.addIssue({ code: 'custom', message: 'options and key' });
  // Question and answer texts are optional: blank answers are lettered A to H (2 to 8 of them).
});
export const homeworkRules = z.object({
  deadline: deadline.nullable(), lateAllowed: z.boolean(), tries: z.enum(['one_time', 'fix_mistakes', 'from_zero']), maxTries: z.number().int().min(1).max(10),
  solutionsOpen: z.enum(['after_hand_in', 'after_deadline']), photosAllowed: z.boolean(),
}).strict().superRefine((r, c) => { if (r.tries === 'one_time' ? r.maxTries !== 1 : r.maxTries < 2) c.addIssue({ code: 'custom', message: 'tries' }); });
export const teacherHomeworkDefinition = z.object({
  title: z.string().trim().min(1).max(200).regex(/^[^\p{Cc}]+$/u), instructions: z.string().max(20000), mode: z.literal('PLATFORM_QUESTIONS'), published: z.boolean(),
  usesMarks: z.literal(true), filePoints: z.literal(0), questions: z.array(question).min(1).max(100), modelAnswer: z.string().max(20000), solutionVideo: z.literal(''),
  solutionVideoId: id.nullable(), referenceIds: z.array(id).max(10), solutionIds: z.array(id).max(10), rules: homeworkRules,
}).strict().superRefine((d, c) => {
  if (new Set(d.questions.map(q => q.id)).size !== d.questions.length) c.addIssue({ code: 'custom', message: 'question ids' });
  if (d.published && d.questions.some(q => q.type !== 'essay' && !q.correctIds.length)) c.addIssue({ code: 'custom', message: 'keys' });
  if (d.published && !d.rules.deadline) c.addIssue({ code: 'custom', message: 'deadline' });
  if (!d.rules.photosAllowed && d.questions.some(q => q.type === 'essay' && q.responseMode !== 'text')) c.addIssue({ code: 'custom', message: 'photos off' });
});
/** Save: a new homework (no revision) or the revision the screen read. */
export const homeworkSave = z.object({ offeringId: id, lessonId: id, revision: revision.nullable(), definition: teacherHomeworkDefinition }).strict();
export const homeworkLifecycle = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), revision }).strict(),
  z.object({ action: z.literal('unpublish'), revision }).strict(),
  z.object({ action: z.literal('clone'), revision }).strict(),
  z.object({ action: z.literal('reschedule'), revision, deadline, lateAllowed: z.boolean() }).strict(),
]);
/** Delete images takes nothing but the confirmation that the teacher saw what it does. */
export const homeworkDeleteImages = z.object({ confirm: z.literal(true) }).strict();
/** Correcting. The queue read: ?tab=to_correct|done|missing&page=n. */
export const queueQuery = z.object({ tab: z.enum(['to_correct', 'done', 'missing']).default('to_correct'), page: page.default(0) }).strict();
/**
 * Correcting one try: save the marks (grade) or release it. The status is never sent: a release is always 'approved' (tries replace the old
 * resubmit request). A released try is edited only with a reason of three or more characters (the database checks it again).
 */
const note = z.string().max(4000);
export const tryWrite = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grade'), revision, feedback: z.string().max(10000), reason: note,
    marks: z.array(z.object({ questionId: id, points: z.number().int().min(0).max(100), feedback: note }).strict()).max(100)
      .refine(m => new Set(m.map(x => x.questionId)).size === m.length) }).strict(),
  z.object({ action: z.literal('release'), revision, reason: note }).strict(),
]);
/** Release many: the queue's list of {submissionId, revision}, 1 to 500, no try twice. All or nothing in the database. */
export const releaseMany = z.object({ items: z.array(z.object({ submissionId: id, revision }).strict()).min(1).max(500)
  .refine(items => new Set(items.map(i => i.submissionId)).size === items.length) }).strict();
export type TryWrite = z.infer<typeof tryWrite>;
export type ReleaseMany = z.infer<typeof releaseMany>;
export type HomeworkSave = z.infer<typeof homeworkSave>;
export type HomeworkLifecycle = z.infer<typeof homeworkLifecycle>;

import { z } from 'zod';
import { deadlinePattern } from '@/shared/contracts/teacher-homework';

/**
 * What the teacher Exams routes accept. Strict everywhere: an unknown key is refused. The caller is never named (the server takes the
 * signed-in identity); revisions are whole numbers compared by the database; a time is ISO 8601 with an explicit offset (the pattern
 * private.exam_iso checks); a day is YYYY-MM-DD (a Cairo day). The database checks every one of these again.
 */
const id = z.string().uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const iso = z.string().max(40).regex(deadlinePattern).refine(v => Number.isFinite(Date.parse(v)));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(`${v}T00:00:00Z`)));
const page = z.coerce.number().int().min(0).max(100000);
const title = z.string().trim().min(1).max(200).regex(/^[^\p{Cc}]+$/u);
/** A mark in halves: 0, 0.5, 1, … */
const halves = (max: number) => z.number().min(0).max(max).refine(n => Number.isInteger(n * 2));

export const EXAM_TABS = ['open', 'closed', 'drafts', 'archived'] as const;
export const portalQuery = z.object({ course: id.optional(), tab: z.enum(EXAM_TABS).default('open'), page: page.default(0) }).strict();
export const queueQuery = z.object({ tab: z.enum(['to_correct', 'corrected', 'missing']).default('to_correct'), page: page.default(0) }).strict();
/** The mark sheet: one Group, 'none' (students in no Group), or every student when absent. */
export const sheetQuery = z.object({ group: z.union([id, z.literal('none')]).optional(), page: page.default(0) }).strict();

/** One question as exam_save takes it: choice (options and right positions), number (value and tolerance) or essay. */
export const examQuestion = z.object({
  type: z.enum(['choice', 'number', 'essay']), text: z.string().max(10000), imageId: id.nullable(), points: z.number().int().min(0).max(1000),
  options: z.array(z.string().max(2000)).min(2).max(8).optional(), correct: z.array(z.number().int().min(0).max(7)).min(1).max(8).optional(),
  numberValue: z.number().finite().optional(), tolerance: z.number().finite().min(0).optional(),
  responseMode: z.enum(['text', 'photo', 'both']).optional(), modelText: z.string().max(10000), modelImageId: id.nullable(),
}).strict().superRefine((q, c) => {
  const choice = q.type === 'choice', number = q.type === 'number', essay = q.type === 'essay';
  if (choice !== (q.options !== undefined) || choice !== (q.correct !== undefined)) c.addIssue({ code: 'custom', message: 'options are for choice questions' });
  if (q.options && q.correct && (new Set(q.correct).size !== q.correct.length || q.correct.some(n => n >= (q.options as string[]).length))) c.addIssue({ code: 'custom', message: 'right answers' });
  if (number !== (q.numberValue !== undefined) || (!number && q.tolerance !== undefined)) c.addIssue({ code: 'custom', message: 'a number is for number questions' });
  if (!essay && q.responseMode !== undefined) c.addIssue({ code: 'custom', message: 'photo answers are for essays' });
});
/** A save sends only what changed shape: every key is optional (a draft saves with less; the database fills the rest). */
export const examDefinition = z.object({
  kind: z.enum(['online', 'paper']).optional(), title: title.optional(), description: z.string().max(8000).optional(),
  chapterIds: z.array(id).max(200).optional(), coversAllChapters: z.boolean().optional(), heldOn: day.nullable().optional(), maxMarks: z.number().int().min(1).max(1000).optional(),
  timing: z.enum(['per_group', 'same_time']).optional(), startingFrom: day.nullable().optional(), opensAt: iso.nullable().optional(), closesAt: iso.nullable().optional(),
  timeLimitMinutes: z.number().int().min(1).max(1440).nullable().optional(), tries: z.enum(['one_time', 'fix_mistakes', 'from_zero']).optional(),
  shuffle: z.boolean().optional(), photosAllowed: z.boolean().optional(), autoRelease: z.boolean().optional(), questions: z.array(examQuestion).max(100).optional(),
}).strict().superRefine((d, c) => {
  if (d.chapterIds && new Set(d.chapterIds).size !== d.chapterIds.length) c.addIssue({ code: 'custom', message: 'chapters' });
  if (d.opensAt && d.closesAt && Date.parse(d.closesAt) <= Date.parse(d.opensAt)) c.addIssue({ code: 'custom', message: 'closes after it opens' });
});
/** Save: a new exam (no revision; its run and kind) or the revision the screen read. An exam keeps its run: no offering for an existing one. */
export const examSave = z.object({ offeringId: id.nullable(), revision: revision.nullable(), definition: examDefinition }).strict();
const times = z.object({ timing: z.enum(['per_group', 'same_time']).optional(), startingFrom: day.optional(), opensAt: iso.nullable().optional(), closesAt: iso.nullable().optional() }).strict();
export const examLifecycle = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), revision }).strict(),
  z.object({ action: z.literal('unpublish'), revision }).strict(),
  z.object({ action: z.literal('archive'), revision }).strict(),
  z.object({ action: z.literal('clone'), revision, offeringId: id.optional() }).strict(),
  z.object({ action: z.literal('reschedule'), revision, times }).strict(),
]);
/** One Group's window: back to the rule (auto), another coming session of that Group (picked), or a time (custom, for a Group with no session). */
export const examWindow = z.discriminatedUnion('source', [
  z.object({ source: z.literal('auto'), groupId: id, revision }).strict(),
  z.object({ source: z.literal('picked'), groupId: id, revision, sessionId: id }).strict(),
  z.object({ source: z.literal('custom'), groupId: id, revision, opensAt: iso, closesAt: iso }).strict(),
]).refine(w => w.source !== 'custom' || Date.parse(w.closesAt) > Date.parse(w.opensAt));
/** A question or model answer picture: ask for a place (intent), then let the server check the bytes (complete), or read one (get). */
export const examUpload = z.discriminatedUnion('action', [
  z.object({ action: z.literal('intent'), purpose: z.enum(['question', 'model']), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), name: z.string().max(255) }).strict(),
  z.object({ action: z.literal('complete'), id }).strict(),
  z.object({ action: z.literal('get'), id }).strict(),
]);
/** Correcting one try (grade: the marks of its essays, in halves; a released mark changes with a reason) or releasing one result. */
export const examWork = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grade'), attemptId: id, revision, reason: z.string().max(4000),
    marks: z.array(z.object({ questionId: id, points: halves(1000), note: z.string().max(2000) }).strict()).min(1).max(100)
      .refine(m => new Set(m.map(x => x.questionId)).size === m.length) }).strict(),
  z.object({ action: z.literal('release'), resultId: id, revision }).strict(),
]);
/** Release many: the queue's or the sheet's list of {resultId, revision}, 1 to 500, none twice. All or nothing. */
export const examReleaseMany = z.object({ items: z.array(z.object({ resultId: id, revision }).strict()).min(1).max(500)
  .refine(items => new Set(items.map(i => i.resultId)).size === items.length) }).strict();
/** Paper marks: [{userId, mark (halves, or null), absent, revision (the result's, null before one), reason}], 1 to 500. Absent has no mark. */
export const examPaperMarks = z.object({ items: z.array(z.object({ userId: id, mark: halves(1000).nullable(), absent: z.boolean(), revision: revision.nullable(), reason: z.string().max(4000) }).strict()
  .refine(i => !(i.absent && i.mark !== null))).min(1).max(500).refine(items => new Set(items.map(i => i.userId)).size === items.length) }).strict();

export type ExamSave = z.infer<typeof examSave>;
export type ExamDefinitionInput = z.infer<typeof examDefinition>;
export type ExamQuestionInput = z.infer<typeof examQuestion>;
export type ExamLifecycle = z.infer<typeof examLifecycle>;
export type ExamWindowInput = z.infer<typeof examWindow>;
export type ExamUpload = z.infer<typeof examUpload>;
export type ExamWork = z.infer<typeof examWork>;
export type ExamReleaseMany = z.infer<typeof examReleaseMany>;
export type ExamPaperMarks = z.infer<typeof examPaperMarks>;

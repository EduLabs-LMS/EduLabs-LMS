import { z } from 'zod';

/**
 * What the student Exams routes accept. Strict everywhere: an unknown key is refused. The caller is never named (the server takes the
 * signed-in identity); revisions are whole numbers compared by the database. The database checks every one of these again and is the only
 * authority: the clock, the window, the tries, what is kept and what a student may see are decided there.
 */
const id = z.string().uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** GET /api/exams/<id>?attempt=<try>: the exam as this student sees it, with one of their tries when asked. */
export const examViewQuery = z.object({ attempt: id.optional() }).strict();

/**
 * One answer to save: a choice (the picked option ids, none to clear), a number (null clears it) or an essay (text and/or one photo that
 * went through the upload route). Exactly one of the three shapes, so nothing is saved by accident.
 */
export const studentAnswer = z.object({
  action: z.literal('save'), attemptId: id, revision, questionId: id,
  optionIds: z.array(id).max(8).refine(a => new Set(a).size === a.length).optional(),
  numberValue: z.number().finite().nullable().optional(),
  text: z.string().max(10000).optional(),
  uploadId: id.nullable().optional(),
}).strict().refine(a => {
  const choice = a.optionIds !== undefined, number = a.numberValue !== undefined, essay = a.text !== undefined || a.uploadId !== undefined;
  return Number(choice) + Number(number) + Number(essay) === 1;
}, { message: 'one kind of answer' });
/** Start a first try, start the second try, or hand in the try that is open. */
export const examStudentWork = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('retry') }).strict(),
  z.object({ action: z.literal('submit'), attemptId: id, revision }).strict(),
]).or(studentAnswer);

/** A photo answer: a place for it in this try (intent), the server's byte check (complete), or a signed link (get). */
export const studentUpload = z.discriminatedUnion('action', [
  z.object({ action: z.literal('intent'), attemptId: id, mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), name: z.string().max(255) }).strict(),
  z.object({ action: z.literal('complete'), id }).strict(),
  z.object({ action: z.literal('get'), id }).strict(),
]);

export type StudentAnswerInput = z.infer<typeof studentAnswer>;
export type ExamStudentWork = z.infer<typeof examStudentWork>;
export type StudentUpload = z.infer<typeof studentUpload>;

import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/shared/contracts/database.types';
import type { LmsRepository, PageRequest } from '@/shared/contracts/lms';

const resultSchema = z.object({
  attempt_id: z.string().uuid(), status: z.enum(['in_progress', 'submitted', 'graded', 'void']),
  score: z.number().nonnegative().nullable(), max_score: z.number().nonnegative().nullable(),
  responses: z.array(z.object({ id: z.string().uuid(), question_id: z.string().uuid(),
    awarded_points: z.number().nonnegative().nullable(), feedback: z.string().nullable(), graded_at: z.string().nullable() })),
});

export function pageRange(value: PageRequest = {}): [number, number] {
  const { page = 0, pageSize = 50 } = value;
  if (!Number.isInteger(page) || page < 0 || page > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid pagination');
  }
  return [page * pageSize, (page + 1) * pageSize - 1];
}

async function read<T>(query: PromiseLike<{ data: T | null; error: { code?: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error || data === null) throw new Error('LMS request failed');
  return data;
}
async function write(query: PromiseLike<{ error: { code?: string } | null }>): Promise<void> {
  if ((await query).error) throw new Error('LMS request failed');
}

/** Internal adapter: pass only a request-scoped client and its verified profile ID. */
export function createSupabaseLmsRepository(client: SupabaseClient<Database>, verifiedProfileId: string): LmsRepository {
  return {
    organizations: p => read(client.from('organizations').select('*').order('id').range(...pageRange(p))),
    memberships: (id, p) => read(client.from('organization_memberships').select('*').eq('organization_id', id).order('user_id').range(...pageRange(p))),
    courses: (id, p) => read(client.from('courses').select('*').eq('organization_id', id).order('id').range(...pageRange(p))),
    modules: id => read(client.from('course_modules').select('*').eq('course_id', id).order('position').limit(500)),
    lessons: id => read(client.from('lessons').select('*').eq('module_id', id).order('position').limit(500)),
    lessonBlocks: id => read(client.from('lesson_blocks').select('*').eq('lesson_id', id).order('position').limit(500)),
    offerings: (id, p) => read(client.from('course_offerings').select('*').eq('course_id', id).order('id').range(...pageRange(p))),
    enrollments: (id, p) => read(client.from('enrollments').select('*').eq('offering_id', id).order('id').range(...pageRange(p))),
    progress: (id, p) => read(client.from('lesson_progress').select('*').eq('offering_id', id).eq('user_id', verifiedProfileId).order('lesson_id').range(...pageRange(p))),
    assessments: (id, p) => read(client.from('assessments').select('*').eq('course_id', id).order('id').range(...pageRange(p))),
    scheduledAssessments: (id, p) => read(client.from('offering_assessments').select('*').eq('offering_id', id).order('id').range(...pageRange(p))),
    questions: id => read(client.from('assessment_questions').select('*').eq('assessment_id', id).order('position').limit(500)),
    options: id => read(client.from('assessment_options').select('id,question_id,text,position').eq('question_id', id).order('position').limit(100)),
    attempts: (id, p) => read(client.from('assessment_attempts').select('id,offering_assessment_id,user_id,attempt_number,started_at,deadline_at,submitted_at,status,created_at,updated_at').eq('offering_assessment_id', id).eq('user_id', verifiedProfileId).order('attempt_number').range(...pageRange(p))),
    responses: (id, p) => read(client.from('assessment_responses').select('id,attempt_id,question_id,response,media_asset_id,updated_at').eq('attempt_id', id).order('question_id').range(...pageRange(p))),
    media: (id, p) => read(client.from('media_assets').select('*').eq('organization_id', id).order('id').range(...pageRange(p))),
    // registerMedia and updateProgress are gone (fix-01-direct-access): media is registered by the upload functions (register_lesson_upload)
    // and progress is saved by save_segment_progress. The browser role has no direct write on media_assets or lesson_progress.
    completeUpload: id => write(client.rpc('complete_media_upload', { p_asset_id: id })),
    abandonUpload: id => write(client.rpc('abandon_media_upload', { p_asset_id: id })),
    startAttempt: id => read(client.rpc('start_assessment_attempt', { p_offering_assessment_id: id })),
    saveResponse: (attemptId, questionId, response, mediaAssetId) => read(client.rpc('save_assessment_response', {
      p_attempt_id: attemptId, p_question_id: questionId, p_response: response, p_media_asset_id: mediaAssetId,
    })),
    submitAttempt: id => write(client.rpc('submit_assessment_attempt', { p_attempt_id: id })),
    gradeResponse: (id, points, feedback) => write(client.rpc('grade_assessment_response', { p_response_id: id, p_points: points, p_feedback: feedback })),
    finalizeGrade: id => write(client.rpc('finalize_assessment_grade', { p_attempt_id: id })),
    results: async id => resultSchema.parse(await read(client.rpc('get_assessment_results', { p_attempt_id: id }))),
  };
}

import type { Database, Json } from './database.types';

type Tables = Database['public']['Tables'];
export type LmsRow<T extends keyof Tables> = Tables[T]['Row'];
export type PageRequest = { page?: number; pageSize?: number };
export type AnswerOption = Pick<LmsRow<'assessment_options'>, 'id' | 'question_id' | 'text' | 'position'>;
export type StudentResponse = Pick<LmsRow<'assessment_responses'>, 'id' | 'attempt_id' | 'question_id' | 'response' | 'media_asset_id' | 'updated_at'>;
export type SafeAttempt = Pick<LmsRow<'assessment_attempts'>, 'id' | 'offering_assessment_id' | 'user_id' | 'attempt_number' | 'started_at' | 'deadline_at' | 'submitted_at' | 'status' | 'created_at' | 'updated_at'>;
export type AssessmentResults = {
  attempt_id: string;
  status: 'in_progress' | 'submitted' | 'graded' | 'void';
  score: number | null;
  max_score: number | null;
  responses: { id: string; question_id: string; awarded_points: number | null; feedback: string | null; graded_at: string | null }[];
};

/** Backend port. Authorization always belongs to the backend, never the UI. */
export interface LmsRepository {
  organizations(page?: PageRequest): Promise<LmsRow<'organizations'>[]>;
  memberships(organizationId: string, page?: PageRequest): Promise<LmsRow<'organization_memberships'>[]>;
  courses(organizationId: string, page?: PageRequest): Promise<LmsRow<'courses'>[]>;
  modules(courseId: string): Promise<LmsRow<'course_modules'>[]>;
  lessons(moduleId: string): Promise<LmsRow<'lessons'>[]>;
  lessonBlocks(lessonId: string): Promise<LmsRow<'lesson_blocks'>[]>;
  offerings(courseId: string, page?: PageRequest): Promise<LmsRow<'course_offerings'>[]>;
  enrollments(offeringId: string, page?: PageRequest): Promise<LmsRow<'enrollments'>[]>;
  progress(offeringId: string, page?: PageRequest): Promise<LmsRow<'lesson_progress'>[]>;
  assessments(courseId: string, page?: PageRequest): Promise<LmsRow<'assessments'>[]>;
  scheduledAssessments(offeringId: string, page?: PageRequest): Promise<LmsRow<'offering_assessments'>[]>;
  questions(assessmentId: string): Promise<LmsRow<'assessment_questions'>[]>;
  options(questionId: string): Promise<AnswerOption[]>;
  attempts(scheduledAssessmentId: string, page?: PageRequest): Promise<SafeAttempt[]>;
  responses(attemptId: string, page?: PageRequest): Promise<StudentResponse[]>;
  media(organizationId: string, page?: PageRequest): Promise<LmsRow<'media_assets'>[]>;
  completeUpload(assetId: string): Promise<void>;
  abandonUpload(assetId: string): Promise<void>;
  startAttempt(scheduledAssessmentId: string): Promise<string>;
  saveResponse(attemptId: string, questionId: string, response: Json, mediaAssetId?: string): Promise<string>;
  submitAttempt(attemptId: string): Promise<void>;
  gradeResponse(responseId: string, points: number, feedback?: string): Promise<void>;
  finalizeGrade(attemptId: string): Promise<void>;
  /** Results follow the database RPC contract and remain withheld until finalized. */
  results(attemptId: string): Promise<AssessmentResults>;
}

export interface LmsMediaStorage {
  upload(bucket: 'lms-course-media' | 'lms-submissions', path: string, file: Blob): Promise<void>;
  download(bucket: 'lms-course-media' | 'lms-submissions', path: string): Promise<Blob>;
}

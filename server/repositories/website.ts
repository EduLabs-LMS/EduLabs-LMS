import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/shared/contracts/database.types';

async function rows<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error || data === null) throw new Error('Unable to load learning data');
  return data;
}

// PostgREST may enforce a row ceiling lower than the requested limit. Never
// interpret a truncated progress set as zero activity or completed parts.
async function completeProgress<T>(query: PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>): Promise<{ rows: T[]; incomplete: boolean }> {
  const { data, error, count } = await query;
  if (error || data === null) throw new Error('Unable to load learning progress');
  // Missing count is unknown completeness, not a proven empty/complete result.
  // Never recover provider/auth/network failures as "incomplete" progress.
  const incomplete = !Number.isSafeInteger(count) || count !== data.length;
  return { rows: incomplete ? [] : data, incomplete };
}

/** Read-only Phase 1 port. Caller JWT + RLS remain authoritative on every query. */
export function createWebsiteRepository(client: SupabaseClient<Database>, profileId: string) {
  return {
    organizations: () => rows(client.from('organizations').select('id,name,status').order('id').limit(101)),
    memberships: () => rows(client.from('organization_memberships').select('organization_id,role,status').eq('user_id', profileId).order('organization_id').limit(101)),
    courseStaff: () => rows(client.from('course_staff').select('course_id,role').eq('user_id', profileId).order('course_id').limit(101)),
    offeringStaff: () => rows(client.from('offering_staff').select('offering_id,role').eq('user_id', profileId).order('offering_id').limit(101)),
    courses: (organizationId?: string, page?: number, title?: string) => {
      let query = client.from('courses').select('id,organization_id,title,description,status');
      if (organizationId) query = query.eq('organization_id', organizationId);
      if (title) query = query.ilike('title', `%${title}%`);
      return rows(page === undefined ? query.order('id').limit(101) : query.order('id').range(page * 100, page * 100 + 100));
    },
    course: (id: string) => rows(client.from('courses').select('id,organization_id,title,description,status').eq('id', id).limit(1)),
    offerings: (courseIds: string[]) => courseIds.length ? rows(client.from('course_offerings').select('id,course_id,name,status,delivery_mode,starts_at,ends_at,timezone').in('course_id', courseIds).order('id').limit(101)) : Promise.resolve([]),
    offering: (id: string) => rows(client.from('course_offerings').select('id,course_id,name,status,delivery_mode,starts_at,ends_at,timezone').eq('id', id).limit(1)),
    myEnrollments: () => rows(client.from('enrollments').select('id,offering_id,status,enrolled_at,expires_at').eq('user_id', profileId).order('id').limit(101)),
    modules: (courseIds: string[]) => courseIds.length ? rows(client.from('course_modules').select('id,course_id,title,group_type,chapter_number,summary,description,position').in('course_id', courseIds).order('position').order('id').limit(501)) : Promise.resolve([]),
    lessons: async (moduleIds: string[]) => {
      // Keep PostgREST URLs bounded as well as row counts (up to five batches).
      const batches: string[][] = [];
      for (let i = 0; i < Math.min(moduleIds.length, 500); i += 100) batches.push(moduleIds.slice(i, i + 100));
      const result = await Promise.all(batches.map(batch => rows(client.from('lessons').select('id,module_id,title,description,cover_asset_id,position,status,estimated_duration_seconds').in('module_id', batch).eq('status', 'published').order('position').order('id').limit(501))));
      return result.flat().sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).slice(0, 501);
    },
    progress: (offeringIds: string[]) => offeringIds.length ? completeProgress(client.from('lesson_progress').select('offering_id,lesson_id,status,last_accessed_at', { count: 'exact' }).eq('user_id', profileId).in('offering_id', offeringIds).order('offering_id').order('lesson_id').limit(1001)) : Promise.resolve({ rows: [], incomplete: false }),
    segments: async(lessonIds:string[]) => {
      const result=[];
      for(let i=0;i<lessonIds.length;i+=50){const batch=await rows(client.from('lesson_segments').select('id,lesson_id,title,position,status,thumbnail_asset_id').in('lesson_id',lessonIds.slice(i,i+50)).eq('status','published').order('position').limit(1001));if(batch.length>1000)throw new Error('Lesson part overview is incomplete');result.push(...batch);}
      return result;
    },
    segmentProgress: (offeringIds:string[]) => offeringIds.length?completeProgress(client.from('lesson_segment_progress').select('offering_id,lesson_id,segment_id,status,video_position_seconds,revision,updated_at', { count: 'exact' }).eq('user_id',profileId).in('offering_id',offeringIds).order('offering_id').order('segment_id').limit(5001)):Promise.resolve({ rows: [], incomplete: false }),
    scheduledAssessments: (offeringIds: string[]) => offeringIds.length ? rows(client.from('offering_assessments').select('id,offering_id,assessment_id,opens_at,closes_at,published').in('offering_id', offeringIds).eq('published', true).order('id').limit(101)) : Promise.resolve([]),
    assessments: (ids: string[]) => ids.length ? rows(client.from('assessments').select('id,title,type').in('id', ids).order('id').limit(101)) : Promise.resolve([]),
    roster: (offeringId: string, page: number) => rows(client.from('enrollments').select('id,user_id,status,enrolled_at,profiles!enrollments_user_id_fkey(display_name)').eq('offering_id', offeringId).order('id').range(page * 50, page * 50 + 50)),
    enrollmentCount: async (offeringIds: string[], status?: string) => {
      if (!offeringIds.length) return 0;
      const query = client.from('enrollments').select('id', { count: 'exact', head: true }).in('offering_id', offeringIds);
      const { count, error } = await (status ? query.eq('status', status) : query);
      if (error || count === null) throw new Error('Unable to count enrollments');
      return count;
    },
  };
}

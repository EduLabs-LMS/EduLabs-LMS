import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { canEditTeacherCourse } from '@/shared/teacher-course';
import type { AcademicProgram, AcademicStage, AcademicPage, AcademicWrite, Classification } from '@/shared/contracts/academics';

export const academicFailure = (message: string, status: number) => Object.assign(new Error(message), { status });
export async function academicResult<T>(query: PromiseLike<{ data: T | null; error: { code?: string } | null }>): Promise<T> {
 const { data, error } = await query;
 if (error || data === null) {
  const code = error?.code;
  throw academicFailure(code === 'PT409' ? 'This record changed. Reload the latest version before saving.' : code === '23505' ? 'This slug is already in use in this program or organization.' : code === '55P03' ? 'Permissions or enrollment are being updated. Please retry shortly.' : code === '42501' ? 'Access denied, or a selected program or stage is no longer available. Reload and check your access.' : ['22023','22P02','23514'].includes(code ?? '') ? 'Check the academic details and selected active stages.' : 'Academic data could not be loaded or saved. Please retry.', code === 'PT409' || code === '23505' ? 409 : code === '42501' ? 403 : ['22023','22P02','23514'].includes(code ?? '') ? 400 : 503);
 }
 return data;
}
export async function academicService(userId: string, organizationId: string) {
 const client = await getSupabaseServerClient();
 const [membership, organization] = await Promise.all([
  academicResult(client.from('organization_memberships').select('role,status').eq('organization_id',organizationId).eq('user_id',userId).eq('status','active').limit(1)),
  academicResult(client.from('organizations').select('id').eq('id',organizationId).eq('status','active').limit(1)),
 ]);
 if (!membership[0] || !organization[0]) throw academicFailure('Teaching access is not available for this organization.',403);
 const canManage = ['owner','admin'].includes(membership[0].role);
 async function editable(courseId: string) {
  const courses = await academicResult(client.from('courses').select('id').eq('id',courseId).eq('organization_id',organizationId).limit(1));
  const staff = await academicResult(client.from('course_staff').select('role').eq('course_id',courseId).eq('user_id',userId).limit(1));
  if (!courses[0] || !canEditTeacherCourse(membership[0],staff[0] ?? null)) throw academicFailure('Course editing is not permitted.',403);
 }
 return {
  async programs(page: number): Promise<AcademicPage<AcademicProgram>> {
   const rows = await academicResult(client.from('academic_programs').select('*').eq('organization_id',organizationId).order('position').order('id').range(page*50,page*50+50));
   return {items:rows.slice(0,50),hasMore:rows.length>50,canManage};
  },
  async stages(programId: string,page: number): Promise<AcademicPage<AcademicStage>> {
   const parent = await academicResult(client.from('academic_programs').select('id').eq('organization_id',organizationId).eq('id',programId).limit(1));
   if (!parent[0]) throw academicFailure('Program not found in this organization.',404);
   const rows = await academicResult(client.from('academic_stages').select('*').eq('organization_id',organizationId).eq('program_id',programId).order('position').order('id').range(page*50,page*50+50));
   return {items:rows.slice(0,50),hasMore:rows.length>50,canManage};
  },
  async classification(courseId: string): Promise<Classification> {
   await editable(courseId);
   const raw = await academicResult(client.rpc('course_stage_classification',{p_course_id:courseId})) as unknown as Omit<Classification,'selected'>;
   if (!Array.isArray(raw.stageIds) || raw.stageIds.length>50 || !Number.isSafeInteger(raw.revision)) throw academicFailure('Course classification response is incomplete.',503);
   const stages = raw.stageIds.length ? await academicResult(client.from('academic_stages').select('id,label,status,program_id').eq('organization_id',organizationId).in('id',raw.stageIds).limit(51)) : [];
   const programIds = Array.from(new Set(stages.map(s=>s.program_id)));
   const programs = programIds.length ? await academicResult(client.from('academic_programs').select('id,label,status').eq('organization_id',organizationId).in('id',programIds).limit(51)) : [];
   if (stages.length!==raw.stageIds.length || programs.length!==programIds.length) throw academicFailure('Classification details are incomplete. Please reload.',503);
   return {...raw,selected:stages.map(s=>({id:s.id,label:s.label,status:s.status,programLabel:programs.find(p=>p.id===s.program_id)!.label,programStatus:programs.find(p=>p.id===s.program_id)!.status}))};
  },
  async write(input: AcademicWrite) {
   if (input.organizationId !== organizationId) throw academicFailure('Organization mismatch.',403);
   if (input.action==='course.assign') await editable(input.id);
   else if (!canManage) throw academicFailure('Only an organization owner or admin can manage programs and stages.',403);
   return academicResult(client.rpc('academic_command',{p_action:input.action,p_organization_id:organizationId,...('id' in input ? {p_entity_id:input.id,p_revision:input.revision} : {}),p_data:input.data}));
  },
 };
}

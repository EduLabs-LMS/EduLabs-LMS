import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { academicFailure, academicResult } from '@/server/services/academics';
import type { StudentAcademics, StudentAcademicWrite } from '@/shared/contracts/student-academics';

/** Bounded complete reads: never turn partial responses into an empty catalog. */
function complete<T>(rows:T[],limit=500):T[] {
 if(rows.length>limit)throw academicFailure('Academic overview is too large. Please contact support to narrow this view.',503);
 return rows;
}
export async function studentAcademicService(userId:string) {
 const client=await getSupabaseServerClient();
 const now=Date.now();
 const enrollments=complete(await academicResult(client.from('enrollments').select('offering_id,status,enrolled_at,expires_at').eq('user_id',userId).eq('status','active').order('id').limit(501)))
  .filter(e=>(!e.expires_at||Date.parse(e.expires_at)>now)&&(!e.enrolled_at||Date.parse(e.enrolled_at)<=now));
 const offeringIds=enrollments.map(e=>e.offering_id);
 const offerings=offeringIds.length?complete(await academicResult(client.from('course_offerings').select('id,course_id').in('id',offeringIds).eq('status','active').limit(501))):[];
 const courseIds=Array.from(new Set(offerings.map(o=>o.course_id)));
 const courses=courseIds.length?complete(await academicResult(client.from('courses').select('id,organization_id').in('id',courseIds).eq('status','published').limit(501))):[];
 const orgIds=Array.from(new Set(courses.map(c=>c.organization_id)));
 const organizations=orgIds.length?complete(await academicResult(client.from('organizations').select('id,name').in('id',orgIds).eq('status','active').order('id').limit(501))):[];
 const eligible=(id:string)=>organizations.some(o=>o.id===id);
 return {
  async catalog(organizationId?:string):Promise<StudentAcademics> {
   if(organizationId&&!eligible(organizationId))throw academicFailure('Enrollment access is not available for this organization.',403);
   const selected=organizations.filter(o=>!organizationId||o.id===organizationId), ids=selected.map(o=>o.id);
   if(!ids.length)return{organizations:[],programs:[],stages:[],preferences:[],assignments:[]};
   const [programs,stages,preferences]=await Promise.all([
    academicResult(client.from('academic_programs').select('*').in('organization_id',ids).eq('status','active').order('position').order('id').limit(501)),
    academicResult(client.from('academic_stages').select('*').in('organization_id',ids).eq('status','active').order('position').order('id').limit(501)),
    academicResult(client.from('student_stage_preferences').select('program_id,stage_id,organization_id,revision').eq('user_id',userId).in('organization_id',ids).limit(501)),
   ]);
   complete(programs);complete(stages);complete(preferences);
   const activeStages=stages.filter(s=>programs.some(p=>p.id===s.program_id));
   const assignments:StudentAcademics['assignments']=[];
   const authorizedCourses=courses.filter(c=>ids.includes(c.organization_id)).map(c=>c.id);
   // Ten courses x the RPC's 50-link maximum fits below PostgREST's default
   // 1,000-row ceiling, including a sentinel. Never classify a clipped link set.
   for(let i=0;i<authorizedCourses.length;i+=10) {
    const rows=complete(await academicResult(client.from('course_stage_assignments').select('course_id,stage_id').in('course_id',authorizedCourses.slice(i,i+10)).order('course_id').order('stage_id').limit(501)));
    assignments.push(...rows);
   }
   return{organizations:selected,programs,stages:activeStages,preferences,assignments};
  },
  async save(input:StudentAcademicWrite) {
   const programs=await academicResult(client.from('academic_programs').select('id,organization_id').eq('id',input.programId).eq('status','active').limit(1));
   const own=await academicResult(client.from('student_stage_preferences').select('organization_id').eq('user_id',userId).eq('program_id',input.programId).limit(1));
   const org=programs[0]?.organization_id??(input.stageId===null?own[0]?.organization_id:undefined);
   if(!org||!eligible(org))throw academicFailure('Program or enrollment access is no longer available. Reload your choices.',403);
   // Identity and same-program checks are revalidated by the existing locked RPC.
   return academicResult(client.rpc('set_student_stage_preference',{p_program_id:input.programId,p_stage_id:input.stageId,p_revision:input.revision}));
  },
 };
}

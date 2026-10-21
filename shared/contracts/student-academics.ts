import { z } from 'zod';
import type { AcademicProgram, AcademicStage } from './academics';
export const studentAcademicQuery = z.object({ organizationId: z.string().uuid().optional() }).strict();
export const studentAcademicWrite = z.object({
 programId: z.string().uuid(), stageId: z.string().uuid().nullable(),
 revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
export type StudentAcademicWrite = z.infer<typeof studentAcademicWrite>;
export type StagePreference = {program_id:string;stage_id:string|null;organization_id:string;revision:number};
export type StudentAcademics = {
 organizations:{id:string;name:string}[]; programs:AcademicProgram[]; stages:AcademicStage[];
 preferences:StagePreference[]; assignments:{course_id:string;stage_id:string}[];
};
/** Discovery only. Input offerings must already be independently authorized. */
export function academicCourseIds(courseIds:string[], data:StudentAcademics, filter:string):string[] {
 if(filter==='all')return courseIds;
 const visible=new Set(data.stages.map(s=>s.id));
 const links=data.assignments.filter(a=>visible.has(a.stage_id));
 const general=(id:string)=>!links.some(a=>a.course_id===id);
 if(filter==='general')return courseIds.filter(general);
 const selected=new Set(data.preferences.flatMap(p=>p.stage_id&&visible.has(p.stage_id)?[p.stage_id]:[]));
 return courseIds.filter(id=>general(id)||links.some(a=>a.course_id===id&&selected.has(a.stage_id)));
}

/** Paused student UI only; taxonomy, preferences and authorization remain intact. */
export const studentAcademicSelectionEnabled=false;

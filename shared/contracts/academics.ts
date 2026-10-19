import { z } from 'zod';
import type { Database } from './database.types';

export type AcademicProgram = Database['public']['Tables']['academic_programs']['Row'];
export type AcademicStage = Database['public']['Tables']['academic_stages']['Row'];
export type AcademicOrganization = { id: string; name: string };
export type AcademicPage<T> = { items: T[]; hasMore: boolean; canManage: boolean };
export type Classification = { courseId: string; revision: number; stageIds: string[]; selected: { id: string; label: string; status: string; programLabel: string; programStatus: string }[] };
const uuid = z.string().uuid();
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const page = z.string().regex(/^(0|[1-9][0-9]{0,4})$/).transform(Number).refine(n=>n<=10000).default('0');
const metadata = z.object({
 label: z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]*$/),
 slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
 description: z.string().max(4000).nullable().optional(),
 position: z.number().int().min(0).max(1000000),
 status: z.enum(['active','archived']),
}).strict();
export const academicQuery = z.discriminatedUnion('kind', [
 z.object({kind:z.literal('programs'),organizationId:uuid,page}).strict(),
 z.object({kind:z.literal('stages'),organizationId:uuid,programId:uuid,page}).strict(),
 z.object({kind:z.literal('classification'),organizationId:uuid,courseId:uuid}).strict(),
]);
export const academicWrite = z.discriminatedUnion('action', [
 z.object({action:z.literal('program.create'),organizationId:uuid,data:metadata}).strict(),
 z.object({action:z.literal('program.edit'),organizationId:uuid,id:uuid,revision,data:metadata.partial().refine(v=>Object.keys(v).length>0)}).strict(),
 z.object({action:z.literal('stage.create'),organizationId:uuid,data:metadata.extend({programId:uuid}).strict()}).strict(),
 z.object({action:z.literal('stage.edit'),organizationId:uuid,id:uuid,revision,data:metadata.partial().refine(v=>Object.keys(v).length>0)}).strict(),
 z.object({action:z.literal('course.assign'),organizationId:uuid,id:uuid,revision,data:z.object({stageIds:z.array(uuid).max(50).refine(ids=>new Set(ids).size===ids.length)}).strict()}).strict(),
]);
export type AcademicWrite = z.infer<typeof academicWrite>;

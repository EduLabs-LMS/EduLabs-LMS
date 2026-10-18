import { z } from 'zod';
const uuid=z.string().uuid(),page=z.number().int().min(0).max(100000).default(0),token=z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiry=z.string().datetime({offset:true}).nullable();
export const studentAdminEnvelope=z.object({action:z.string().max(24),offeringId:uuid.nullable().optional(),subjectId:uuid.nullable().optional(),version:z.number().int().nonnegative().nullable().optional(),requestId:uuid.optional(),data:z.record(z.unknown()).default({})}).strict();
export const studentAdminReadActions=['offerings','metrics','mine','inspect','roster','requests','links'];
export function studentAdminData(action:string,data:unknown){
 const schemas:Record<string,z.AnyZodObject>={offerings:z.object({page}),metrics:z.object({organizationId:uuid.optional()}),mine:z.object({page}),inspect:z.object({token}),request:z.object({token}),accept:z.object({token}),
  roster:z.object({page,search:z.string().max(120).default(''),filter:z.enum(['all','active','suspended','expired','completed','cancelled','invited']).default('all')}),
  requests:z.object({page,search:z.string().max(120).default(''),filter:z.enum(['all','pending','approved','rejected']).default('pending')}),links:z.object({page}),
  link:z.object({token,kind:z.enum(['request','invite']),recipientId:uuid.nullable(),expiresAt:z.string().datetime({offset:true}),enrollmentExpiresAt:expiry}),'revoke-link':z.object({linkId:uuid}),
  approve:z.object({expiresAt:expiry}),reject:z.object({reason:z.string().trim().min(1).max(1000)}),enroll:z.object({expiresAt:expiry}),suspend:z.object({}),reactivate:z.object({expiresAt:expiry}),
 };if(!schemas[action])throw Object.assign(Error('Unknown operation'),{status:400});const value=schemas[action].strict().parse(data);if(action==='link'&&((value.kind==='invite')!==!!value.recipientId))throw Object.assign(Error('Invitation requires intended student profile ID'),{status:400});return value;
}
export type AdminMetrics={totalStudents:number;pendingWaitlistCount:number;pendingHomeworkCount:number;activeGroupsCount:number};
export type AdminOffering={id:string;name:string;course_title:string;organization_name:string;manage:boolean};
export type StudentRow={id:string;user_id:string;display_name:string|null;status:string;version:number;expires_at?:string|null;reason?:string;eligible?:boolean};
export type AccessDetails={name:string;organization:string;kind:'request'|'invite';expiresAt:string;enrolled:boolean;requestStatus:string|null};
export function safeStudentAuthDestination(value:string|null){return value==='/access'||/^\/join\/[A-Za-z0-9_-]{43}$/.test(value??'')?value!:'/home';}

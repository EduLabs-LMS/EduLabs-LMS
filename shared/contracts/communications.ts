import { z } from 'zod';
export const notificationEvents = ['account_approved','lesson_published','session_details','session_starting','exam_released','homework_released','support_reply','class_started'] as const;
export type NotificationEvent = typeof notificationEvents[number];
export const eventLabels: Record<NotificationEvent,string> = {
 account_approved:'Learning access approved',lesson_published:'A new lesson is available',session_details:'Online session details published',
 session_starting:'Your online session starts soon',exam_released:'Your exam results are available',homework_released:'Your homework feedback is available',support_reply:'You have a support reply',class_started:'Your class has started',
};
const uuid=z.string().uuid();
export const communicationRequest=z.object({
 domain:z.enum(['notifications','support']), action:z.string().min(1).max(25), id:uuid.nullable().optional(),
 version:z.number().int().nonnegative().nullable().optional(),requestId:uuid.optional(),data:z.record(z.unknown()).default({}),
}).strict();
export function validateCommunication(domain:string,action:string,data:unknown){
 const page=z.number().int().min(0).max(100000).default(0);
 const schemes:Record<string,z.ZodTypeAny>=domain==='notifications'?{
  list:z.object({page,filter:z.enum(['all','read','unread']).default('all')}),read:z.object({id:uuid}),unread:z.object({id:uuid}),'read-all':z.object({}),preferences:z.object({}),'push-config':z.object({}),
  preference:z.object({event:z.enum(notificationEvents),inApp:z.boolean(),push:z.boolean()}),
  subscribe:z.object({endpoint:z.string().url().max(2048),p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),auth:z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/)}),
  unsubscribe:z.object({endpoint:z.string().url().max(2048)}),
 }:{
  organizations:z.object({}),list:z.object({page,filter:z.enum(['ALL','OPEN','IN_PROGRESS','RESOLVED']).default('ALL'),search:z.string().max(120).default('')}),get:z.object({page}),
  create:z.object({organizationId:uuid.nullable(),category:z.enum(['account','video','upload','exam','website','other']),subject:z.string().trim().min(1).max(120),body:z.string().trim().min(1).max(2000)}),
  reply:z.object({body:z.string().trim().min(1).max(2000)}),status:z.object({status:z.enum(['OPEN','IN_PROGRESS','RESOLVED'])}),assign:z.object({userId:uuid.nullable()}),
 };
 const schema=schemes[action];if(!schema)throw Object.assign(new Error('Unknown operation'),{status:400});return (schema as z.AnyZodObject).strict().parse(data);
}
export interface NotificationRow {id:string;event_type:NotificationEvent;created_at:string;read_at:string|null;link:string|null}
export interface NotificationPage {rows:NotificationRow[];page:number;unread:number}
export interface NotificationPreference {event_type:NotificationEvent;in_app:boolean;push:boolean}
export interface SupportTicket {id:string;subject:string;category:string;organization_id:string|null;status:'OPEN'|'IN_PROGRESS'|'RESOLVED';version:number;created_at:string;updated_at:string;last_message_at:string;response_due_at:string|null;first_staff_response_at:string|null;assigned_to:string|null;staff?:boolean}
export interface SupportDetail {ticket:SupportTicket;staff:boolean;page:number;assignees:{id:string;name:string}[];messages:{id:string;body:string;created_at:string;staff:boolean;mine:boolean;sender_name:string}[]}

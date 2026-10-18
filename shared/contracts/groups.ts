import { z } from 'zod';
const id=z.string().uuid(),stamp=z.string().datetime({offset:true});
export const weeklySchedule=z.object({weekday:z.number().int().min(0).max(6),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),durationMinutes:z.number().int().min(1).max(1440)}).strict();
export function validGroupMeetingUrl(value:string){
 if(value==='')return true;
 if(value.length>2000||/[\s\x00-\x1f\x7f-\uffff\\]/.test(value))return false;
 const m=/^https:\/\/([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][A-Za-z0-9._~!$&'()*+,;=:@/?#%+-]*)?$/.exec(value);if(!m)return false;
 const host=m[1];if(host.length>253||!/(\.[A-Za-z]{2,63}|\.xn--[A-Za-z0-9-]{2,59})$/.test(host)||!host.split('.').every(l=>l.length<=63&&/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(l)))return false;
 if(m[2]&&(Number(m[2])<1||Number(m[2])>65535))return false;
 return !/%(?![A-Fa-f0-9]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value);
}
const secureUrl=z.string().refine(validGroupMeetingUrl,'Use an HTTPS URL with a valid full DNS hostname and no credentials');
export const groupStreamIcons=['video','radio','users','presentation','headphones','messages'] as const;
export const streamPresentation=z.object({streamLabel:z.string().trim().min(1).max(80).refine(v=>!Array.from(v).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127),'Use a single-line label'),streamIcon:z.enum(groupStreamIcons)}).strict();
const groupFields=z.object({name:z.string().trim().min(1).max(160),description:z.string().max(4000),mode:z.enum(['online','center']),location:z.string().max(1000),joinUrl:secureUrl,instructions:z.string().max(2000),capacity:z.number().int().min(1).max(10000).nullable(),schedules:z.array(weeklySchedule).max(14),streamLabel:streamPresentation.shape.streamLabel.optional(),streamIcon:streamPresentation.shape.streamIcon.optional()}).strict();
export const groupEdit=groupFields.extend({applyMeetingDefaults:z.boolean().optional()}).partial().superRefine((v,c)=>{if(v.schedules&&new Set(v.schedules.map(s=>`${s.weekday}:${s.time}`)).size!==v.schedules.length)c.addIssue({code:'custom',path:['schedules'],message:'Duplicate meeting time'});});
export const groupDefinition=groupFields.superRefine((v,c)=>{if(v.mode==='center'&&!v.location.trim())c.addIssue({code:'custom',path:['location'],message:'Enter a center location'});if(new Set(v.schedules.map(s=>`${s.weekday}:${s.time}`)).size!==v.schedules.length)c.addIssue({code:'custom',path:['schedules'],message:'Duplicate meeting time'});});
export const sessionDefinition=z.object({title:z.string().trim().min(1).max(200),startsAt:stamp,endsAt:stamp}).strict().refine(v=>Date.parse(v.endsAt)>Date.parse(v.startsAt)&&Date.parse(v.endsAt)-Date.parse(v.startsAt)<=86400000,'Session must last between 1 second and 24 hours');
export const groupRead=z.object({groupId:id.nullable(),section:z.string().max(60).default('sessions'),page:z.number().int().min(0).max(100000).default(0),search:z.string().max(160).default('')}).strict();
export type GroupDefinition=z.infer<typeof groupDefinition>;
export type StudyGroup={stream_label?:string;stream_icon?:typeof groupStreamIcons[number];id:string;offering_id:string;offering_name:string;name:string;description:string;mode:'online'|'center';location:string;join_url:string;instructions:string;capacity:number|null;status:'active'|'archived';version:number;staff:boolean;instructor:boolean};
export type GroupSession={id:string;group_id:string;title:string;starts_at:string;ends_at:string;mode:'online'|'center';location:string;join_url:string;instructions:string;cancelled:boolean;version:number;attendance_state:'draft'|'finalized'|'reopened';state:'upcoming'|'ongoing'|'completed'|'cancelled'};
export type GroupRow={user_id:string;display_name:string;id?:string;starts_at?:string;ends_at?:string|null;status?:'not_marked'|'attended'|'absent';assigned?:boolean;eligible?:boolean;session_id?:string;title?:string;action?:string;reason?:string;created_at?:string};
export type GroupPage<T>={rows:T[];page:number;hasMore?:boolean;catchingUp?:boolean;serverNow?:string;nextSession?:GroupSession|null;session?:GroupSession;counts?:{attended:number;absent:number;not_marked:number}};
export function sessionState(s:Pick<GroupSession,'starts_at'|'ends_at'|'cancelled'>,now:number){return s.cancelled?'cancelled':now>=Date.parse(s.ends_at)?'completed':now>=Date.parse(s.starts_at)?'ongoing':'upcoming';}
export function nextSession(sessions:GroupSession[],now:number){return sessions.filter(s=>!s.cancelled&&Date.parse(s.ends_at)>now).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0]??null;}
export function cairoSessionLabel(iso:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',weekday:'long',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso));}
// Convert a wall-clock input independently of machine time zone. Reject DST gaps;
// choose the later instant during a fall-back fold, matching PostgreSQL.
export function cairoWallTime(value:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Use a Cairo date and time');
 const wall=Date.parse(value+'Z');if(!Number.isFinite(wall))throw Error('Invalid date');
 const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const matches=[2,3].map(offset=>wall-offset*3600000).filter(t=>formatter.format(new Date(t)).replace(' ','T')===value);
 if(!matches.length)throw Error('This Cairo time does not exist due to daylight saving');return new Date(Math.max(...matches)).toISOString();
}

export const groupSummarySchema=z.object({own:z.object({attended:z.number().int().nonnegative(),absent:z.number().int().nonnegative()}),staff:z.object({attended:z.number().int().nonnegative(),absent:z.number().int().nonnegative()}),pendingHomework:z.number().int().nonnegative()});
export type GroupSummary=z.infer<typeof groupSummarySchema>;
export function attendanceLabel(status:string){return status==='attended'?'Attended':status==='absent'?'Absent':'Pending / Unmarked';}

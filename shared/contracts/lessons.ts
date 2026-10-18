import { z } from 'zod';

export const lessonId = z.string().uuid();
export const lessonVideo = z.string().max(2048).refine(value => {
 if (!value) return true;
 try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password &&
  Boolean(lessonPlayback(value)); } catch { return false; }
}, 'Use HTTPS YouTube, Vimeo or MP4 media.');
const title = z.string().trim().min(1).max(200);
export const lessonUploadIntent=z.object({mime:z.enum(['application/pdf','video/mp4','image/png','image/jpeg','image/webp']),name:title}).strict();
export const lessonFileFormats:Record<string,{kind:string;limit:number}>={
 'application/pdf':{kind:'pdf',limit:20*1024*1024},'video/mp4':{kind:'video',limit:50_000_000},
 'image/png':{kind:'image',limit:5*1024*1024},'image/jpeg':{kind:'image',limit:5*1024*1024},'image/webp':{kind:'image',limit:5*1024*1024},
};
export function validLessonFile(bytes:Uint8Array,mime:string) {
 const format=lessonFileFormats[mime];if(!Object.prototype.hasOwnProperty.call(lessonFileFormats,mime)||!format||!bytes.length||bytes.length>format.limit)return false;
 const ascii=(a:number,b:number)=>Array.from(bytes.subarray(a,b)).map(n=>String.fromCharCode(n)).join('');
 return mime==='application/pdf'?ascii(0,5)==='%PDF-':mime==='video/mp4'?ascii(4,8)==='ftyp':mime==='image/png'?[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
}
export const learningEdit = z.object({
 action: z.enum(['create_module','edit_module','reorder_modules','set_lesson_cover','create_lesson','edit_lesson','reorder_lessons','create_segment','edit_segment','reorder_segments','attach_resource','remove_resource','edit_block']),
 id: lessonId.nullable(), parentId: lessonId.nullable(), updatedAt: z.string().datetime({offset:true}).nullable(),
 data: z.object({ title: title.optional(), description: z.string().max(100000).optional(),text:z.string().max(100000).optional(), status: z.enum(['draft','published']).optional(),
  cover_asset_id: lessonId.nullable().optional(), video_url: lessonVideo.optional(), video_asset_id: lessonId.nullable().optional(), thumbnail_asset_id: lessonId.nullable().optional(), group_type:z.enum(['Chapter','Month','Unit','Week','Module','Term','Revision']).optional(), name: title.optional(), asset_id: lessonId.optional(), resource_id: lessonId.optional(),
  items: z.array(z.object({id:lessonId,updated_at:z.string().datetime({offset:true})}).strict()).max(500).optional(),
 }).strict(),
}).strict();
export type LearningEdit = z.infer<typeof learningEdit>;
export type LearningModule = { id:string;course_id:string;title:string;group_type:string;description:string|null;position:number;updated_at:string };
export type LearningLesson = { cover_asset_id?:string|null; id:string;module_id:string;title:string;description:string;position:number;status:string;updated_at:string };
export type LearningSegment = { id:string;lesson_id:string;title:string;description:string;position:number;status:string;video_url:string|null;video_asset_id:string|null;thumbnail_asset_id:string|null;updated_at:string };
export type LearningResource = {id:string;segment_id:string;name:string;media_asset_id:string};
export type LearningBlock = {id:string;lesson_id:string;block_type:string;position:number;content:import('./database.types').Json;media_asset_id:string|null;updated_at:string};
export type SegmentProgress = {segment_id:string;lesson_id:string;offering_id:string;status:string;video_position_seconds:number;revision:number};
export type LearningTree = {modules:LearningModule[];lessons:LearningLesson[];segments:LearningSegment[];resources:LearningResource[];blocks:LearningBlock[]};

export function lessonPartHref(courseId:string,segmentId:string,offeringId:string) {
 return `/courses/${courseId}/chapters/${segmentId}?offering=${offeringId}`;
}
export function continuePart(parts:LearningSegment[],progress:SegmentProgress[],offeringId:string) {
 const rows = parts.filter(p=>p.status==='published').sort((a,b)=>a.position-b.position);
 return rows.find(s=>progress.some(p=>p.offering_id===offeringId&&p.segment_id===s.id&&p.status==='in_progress')) ??
 rows.find(s=>!progress.some(p=>p.offering_id===offeringId&&p.segment_id===s.id&&p.status==='completed')) ?? rows[0];
}

export function lessonPlayback(url:string|null): {kind:'embed'|'video';url:string}|null {
 if (!url) return null;
 try {
  const u=new URL(url); if(u.protocol!=='https:'||u.username||u.password)return null;
  const host=u.hostname.replace(/^www\./,'');
  if(host==='youtu.be'||host==='youtube.com'||host==='m.youtube.com'){
   const id=host==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')??u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
   return id&&/^[\w-]{6,20}$/.test(id)?{kind:'embed',url:`https://www.youtube-nocookie.com/embed/${id}`}:null;
  }
  if(host==='vimeo.com'||host==='player.vimeo.com') {const id=u.pathname.match(/(?:video\/)?(\d+)$/)?.[1];return id?{kind:'embed',url:`https://player.vimeo.com/video/${id}`}:null;}
  if(/\.(mp4|webm)$/i.test(u.pathname)||u.pathname.includes('/storage/v1/object/sign/'))return {kind:'video',url};
  return null;
 }catch{return null;}
}

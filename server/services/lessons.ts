import 'server-only';
import { validateLessonImage } from './lesson-image-validation';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { getApplicationViewer } from '@/server/services/application-auth';
import { editableTeacherCourse } from '@/server/services/teacher-course';
import { learningEdit, lessonId,lessonUploadIntent,validLessonFile,type LearningTree, type SegmentProgress } from '@/shared/contracts/lessons';
import type { Json } from '@/shared/contracts/database.types';
import { lessonThumbnails } from '@/server/services/lesson-media';

export function lessonFailure(message:string,status=400) { return Object.assign(new Error(message),{status}); }
async function checked<T>(query:PromiseLike<{data:T|null;error:{code?:string}|null}>):Promise<NonNullable<T>> {
 const {data,error}=await query;
 if(!error&&data===null)throw lessonFailure('Lesson unavailable or access expired',403);
 if(error||data===null){
  const code=error?.code;
  const message=code==='PT409'?'Content or progress changed. Reload before saving.':code==='PGRST205'||code==='PGRST202'?'Lessons requires its approved development database update.':code==='23514'?'Check the content, publish a part before its lesson, and use authorized ready media.':code==='42501'||code==='PGRST116'?'Lesson unavailable or access expired':'Lesson operation unavailable';
  throw lessonFailure(message,code==='PT409'?409:code==='42501'||code==='PGRST116'?403:['23514','23505','22P02'].includes(code??'')?400:503);
 }
 return data as NonNullable<T>;
}
export async function learningService(courseId:string,teacher=false) {
 lessonId.parse(courseId);
 const viewer=await getApplicationViewer();if(!viewer||viewer.backend!=='firebase')throw lessonFailure('Sign in required',401);
 const client=await getSupabaseServerClient();
 const course=teacher?await editableTeacherCourse(viewer.id,courseId):await checked(client.from('courses').select('id,organization_id,title,status').eq('id',courseId).maybeSingle());
 if(!course)throw lessonFailure('Course unavailable',404);
 async function batch<T>(ids:string[],query:(part:string[])=>PromiseLike<{data:T[]|null;error:{code?:string}|null}>) {
  const results:T[]=[];
  for(let i=0;i<ids.length;i+=50){const data=await checked(query(ids.slice(i,i+50)));if(data.length>500)throw lessonFailure('Content is too large for this editor. Narrow the module.',413);results.push(...data);}
  if(results.length>5000)throw lessonFailure('Content is too large for this editor.',413);return results;
 }
 async function tree():Promise<LearningTree> {
  const modules=await checked(client.from('course_modules').select('*').eq('course_id',courseId).order('position').limit(501));
  if(modules.length>500)throw lessonFailure('Too many modules. Contact your teacher.',413);
  const lessons=await batch(modules.map(m=>m.id),ids=>{const q=client.from('lessons').select('*').in('module_id',ids).order('position').limit(501);return teacher?q:q.eq('status','published');});
  const segments=await batch(lessons.map(l=>l.id),ids=>{const q=client.from('lesson_segments').select('*').in('lesson_id',ids).order('position').limit(501);return teacher?q:q.eq('status','published');});
  const resources=await batch(segments.map(s=>s.id),ids=>client.from('lesson_resources').select('*').in('segment_id',ids).limit(501));
  const blocks=await batch(lessons.map(l=>l.id),ids=>client.from('lesson_blocks').select('id,lesson_id,block_type,position,content,media_asset_id,updated_at').in('lesson_id',ids).order('position').limit(501));
  return {modules,lessons,segments,resources,blocks};
 }
 async function offering(id:string) {
  lessonId.parse(id);
  const o=await checked<{id:string;course_id:string;status:string}>(client.from('course_offerings').select('id,course_id,status').eq('id',id).single());
  const e=await checked<{status:string;enrolled_at:string|null;expires_at:string|null}>(client.from('enrollments').select('status,enrolled_at,expires_at').eq('offering_id',id).eq('user_id',viewer!.id).maybeSingle());
  const now=Date.now();
  if(o.course_id!==courseId||o.status!=='active'||course!.status!=='published'||e?.status!=='active'||(e.enrolled_at&&Date.parse(e.enrolled_at)>now)||(e.expires_at&&Date.parse(e.expires_at)<=now))throw lessonFailure('Active course enrollment required',403);
 }
 async function media(id:string) {
  const asset=await checked<{bucket:string;object_path:string;status:string}>(client.from('media_assets').select('bucket,object_path,status').eq('id',id).single());
  if(asset.status!=='ready')throw lessonFailure('Media is not ready',404);
  const signed=await client.storage.from(asset.bucket).createSignedUrl(asset.object_path,600);
  if(signed.error||!signed.data)throw lessonFailure('Media access expired or unavailable',403);
  return signed.data.signedUrl;
 }
 async function cleanup(id:string) {
  if(!teacher)throw lessonFailure('Cleanup denied',403);
  const asset=await checked<{organization_id:string;bucket:string;object_path:string}>(client.from('media_assets').select('organization_id,bucket,object_path').eq('id',id).single());
  if(asset.organization_id!==course!.organization_id||asset.bucket!=='lms-course-media')throw lessonFailure('Cleanup denied',403);
  await checked(client.rpc('archive_unused_lesson_upload',{p_asset_id:id}).then(r=>({...r,data:r.error?null:true})));
  const removed=await client.storage.from(asset.bucket).remove([asset.object_path]);if(removed.error)throw lessonFailure('Archived upload retained for trusted Storage cleanup',503);
  return {archived:true};
 }
 async function resource(id:string) {
  const r=await checked<{segment_id:string;media_asset_id:string}>(client.from('lesson_resources').select('segment_id,media_asset_id').eq('id',id).single());
  const segment=await checked<{lesson_id:string}>(client.from('lesson_segments').select('lesson_id').eq('id',r.segment_id).single());
  const lesson=await checked<{module_id:string}>(client.from('lessons').select('module_id').eq('id',segment.lesson_id).single());
  const parent=await checked<{course_id:string}>(client.from('course_modules').select('course_id').eq('id',lesson.module_id).single());
  if(parent.course_id!==courseId)throw lessonFailure('Resource unavailable',403);
  return media(r.media_asset_id);
 }
 async function blockResource(id:string) {
  const block=await checked<{lesson_id:string;media_asset_id:string|null}>(client.from('lesson_blocks').select('lesson_id,media_asset_id').eq('id',id).single());
  if(!block.media_asset_id)throw lessonFailure('Resource unavailable',404);
  const lesson=await checked<{module_id:string}>(client.from('lessons').select('module_id').eq('id',block.lesson_id).single());
  const parent=await checked<{course_id:string}>(client.from('course_modules').select('course_id').eq('id',lesson.module_id).single());
  if(parent.course_id!==courseId)throw lessonFailure('Resource unavailable',403);
  return media(block.media_asset_id);
 }
 async function registerUpload(mime:string,name:string) {
  if(!teacher)throw lessonFailure('Upload denied',403);
  lessonUploadIntent.parse({mime,name});
  return checked(client.rpc('register_lesson_upload',{p_course_id:courseId,p_mime:mime,p_filename:name}));
 }
 async function finishUpload(id:string) {
  if(!teacher)throw lessonFailure('Upload denied',403);
  const info=await checked(client.rpc('get_lesson_upload',{p_course_id:courseId,p_asset_id:id}));
  if(typeof info!=='object'||Array.isArray(info)||typeof info.path!=='string'||typeof info.mime!=='string'||typeof info.name!=='string')throw lessonFailure('Upload unavailable',403);
  const stored=await client.storage.from('lms-course-media').download(info.path);
  if(stored.error||!stored.data)throw lessonFailure('Uploaded file could not be checked',503);
  const bytes=new Uint8Array(await stored.data.arrayBuffer());
  if(!validLessonFile(bytes,info.mime))throw lessonFailure('Stored file signature or size is invalid');
  if(info.mime.startsWith('image/')){try{await validateLessonImage(bytes,info.mime);}catch{throw lessonFailure('Image content is invalid or too large');}}
  await checked(client.rpc('complete_media_upload',{p_asset_id:id}).then(r=>({...r,data:r.error?null:true})));
  return {id,name:info.name,kind:info.mime==='video/mp4'?'video':info.mime==='application/pdf'?'pdf':'image'};
 }
 return {course,tree,media,offering,cleanup,resource,blockResource,registerUpload,finishUpload,thumbnails:(ids:string[])=>lessonThumbnails(client,ids),
  progress:async(offeringId:string):Promise<SegmentProgress[]>=>{await offering(offeringId);return checked(client.from('lesson_segment_progress').select('segment_id,lesson_id,offering_id,status,video_position_seconds,revision').eq('offering_id',offeringId).eq('user_id',viewer.id).limit(5001));},
  edit:async(input:unknown)=>{if(!teacher)throw lessonFailure('Editing denied',403);const v=learningEdit.parse(input);return checked(client.rpc('edit_learning_content',{p_course_id:courseId,p_action:v.action,p_id:v.id,p_parent_id:v.parentId,p_updated_at:v.updatedAt,p_data:v.data as Json}));},
  saveProgress:async(offeringId:string,segmentId:string,position:number,complete:boolean,revision:number)=>checked(client.rpc('save_segment_progress',{p_offering_id:offeringId,p_segment_id:segmentId,p_position:position,p_complete:complete,p_revision:revision})),
  upload:async(bytes:Buffer,mime:string,name:string)=>{
   if(!teacher)throw lessonFailure('Upload denied',403);
   const allowed:Record<string,{kind:string;extension:string;limit:number}>={'application/pdf':{kind:'pdf',extension:'pdf',limit:20*1024*1024},'video/mp4':{kind:'video',extension:'mp4',limit:50_000_000},'image/png':{kind:'image',extension:'png',limit:5*1024*1024},'image/jpeg':{kind:'image',extension:'jpg',limit:5*1024*1024},'image/webp':{kind:'image',extension:'webp',limit:5*1024*1024}};
   const format=allowed[mime];if(!format||bytes.length>format.limit||!bytes.length)throw lessonFailure('Unsupported file type or size',415);
   const valid=mime==='application/pdf'?bytes.toString('ascii',0,5)==='%PDF-':mime==='video/mp4'?bytes.toString('ascii',4,8)==='ftyp':mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
   if(!valid)throw lessonFailure('File content does not match its type');
   const registered=await checked(client.rpc('register_lesson_upload',{p_course_id:courseId,p_mime:mime,p_filename:name.slice(0,200)}));
   if(typeof registered!=='object'||Array.isArray(registered)||typeof registered.id!=='string'||typeof registered.path!=='string')throw lessonFailure('Upload registration failed',503);
   const id=registered.id,path=registered.path;
   try {
    const upload=await client.storage.from('lms-course-media').upload(path,bytes,{contentType:mime,upsert:false});
    if(upload.error)throw lessonFailure('Upload failed',503);
    await checked(client.rpc('complete_media_upload',{p_asset_id:id}).then(result=>({...result,data:result.error?null:true})));
   } catch {
    try {await cleanup(id);}catch{throw lessonFailure('Upload incomplete; exact asset '+id+' retained for trusted cleanup.',503);}
    throw lessonFailure('Upload failed; the unused object was cleaned safely.',503);
   }
   return {id,name:name.slice(0,200),kind:format.kind};
  },
 };
}

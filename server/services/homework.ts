import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { getFirebaseAdminAuth } from '@/server/integrations/firebase-admin';
import { getFirebaseSession } from '@/server/services/firebase-auth';
import { getSupabaseConfig } from '@/shared/supabase-config';
import { validateHomeworkBytes } from '@/server/services/homework-file-validation';
import type { Database,Json } from '@/shared/contracts/database.types';
import { copyHomeworkCloneTasks, type HomeworkCloneTask } from '@/server/services/homework-clone-media';
import { studentHomeworkReason,studentReasonText } from '@/shared/student-homework';
import type { HomeworkView } from '@/shared/contracts/homework';
export const homeworkFailure=(message:string,status=400)=>Object.assign(new Error(message),{status});
export async function homeworkChecked<T>(query:PromiseLike<{data:T|null;error:{code?:string}|null}>) {
 const {data,error}=await query;if(error||data===null){if(error)console.error('Homework database request rejected',{code:error.code});const code=error?.code,status=code==='42501'?403:code==='PT409'?409:['23514','23505','22P02','22023','22003'].includes(code??'')?400:503;const reason=studentHomeworkReason(error);throw Object.assign(homeworkFailure(reason?studentReasonText[reason]:status===409?'Homework changed. Reload before saving.':status===403?'Homework unavailable or permission denied':status===400?'Check the homework structure, files and correction state.':'Homework requires its approved database update or is temporarily unavailable.',status),reason?{reason}:{});}return data;
}
export async function homeworkService() {
 const client=await getSupabaseServerClient();
 async function info(assignmentId:string,id:string,action='get') {const v=await homeworkChecked(client.rpc('homework_upload',{p_assignment:assignmentId,p_action:action,p_id:id}));if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.path!=='string'||typeof v.mime!=='string'||typeof v.name!=='string')throw homeworkFailure('File unavailable',403);return {path:v.path,mime:v.mime,name:v.name};}
 async function media(assignmentId:string,id:string) {const v=await info(assignmentId,id);const r=await client.storage.from('lms-homework').createSignedUrl(v.path,300);if(r.error||!r.data)throw homeworkFailure('File access unavailable',403);return {id,name:v.name,mime:v.mime,url:r.data.signedUrl};}
 const service = {client,
  get:async(id:string,submissionId:string|null=null)=>(await homeworkChecked(client.rpc('get_homework',{p_assignment:id,p_submission:submissionId}))) as unknown as HomeworkView,
  media,
  finish:async(assignmentId:string,id:string)=>{
   const v=await info(assignmentId,id,'pending'),stored=await client.storage.from('lms-homework').download(v.path);
   if(stored.error||!stored.data)throw homeworkFailure('Upload cannot be verified',403);
   const bytes=new Uint8Array(await stored.data.arrayBuffer());let pages:number|null;try{({pages}=await validateHomeworkBytes(bytes,v.mime));}catch{throw homeworkFailure('File is corrupted, unsupported or oversized.');}
   const session=await getFirebaseSession();if(!session||!session.identity.email_verified)throw homeworkFailure('Verified session required',401);
   // The attestation is short lived, exact-upload scoped and stays on the server.
   // Never persist it as a user custom claim or send its token to the browser.
   const token=await getFirebaseAdminAuth().createCustomToken(session.identity.uid,{role:'authenticated',hw_upload:{id,size:bytes.length,pages,sha256:createHash('sha256').update(bytes).digest('hex')}});
   const exchange=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(process.env.NEXT_PUBLIC_FIREBASE_API_KEY??'')}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,returnSecureToken:true}),cache:'no-store'});
   const payload=await exchange.json();if(!exchange.ok||typeof payload.idToken!=='string'){console.error('Homework upload attestation exchange rejected',{status:exchange.status,code:typeof payload.error?.message==='string'?payload.error.message.replace(/[^A-Z_]/g,'').slice(0,60):'UNKNOWN'});throw homeworkFailure('Server upload verification unavailable',503);}
   const {url,publishableKey}=getSupabaseConfig();const verified=createClient<Database>(url,publishableKey,{accessToken:async()=>payload.idToken,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   await homeworkChecked(verified.rpc('homework_upload',{p_assignment:assignmentId,p_action:'complete',p_id:id}));return {id,name:v.name,mime:v.mime};
  },
  cleanup:async(assignmentId:string,id:string)=>{const v=await homeworkChecked(client.rpc('homework_upload',{p_assignment:assignmentId,p_action:'archive',p_id:id}));if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.path!=='string')throw homeworkFailure('Cleanup unavailable',403);const r=await client.storage.from('lms-homework').remove([v.path]);if(r.error)throw homeworkFailure('Archived file retained for exact trusted cleanup',503);return {archived:true};},
  list:async(courseId:string,lessonId:string,segmentId:string|null,offeringId:string|null,page=0)=>{let q=client.from('homework_assignments').select('id,title,status,mode,offering_id,segment_id,version',{count:'exact'}).eq('course_id',courseId).eq('lesson_id',lessonId).order('created_at').order('id').range(page*25,page*25+24);if(segmentId)q=q.or(`segment_id.is.null,segment_id.eq.${segmentId}`);if(offeringId)q=q.eq('offering_id',offeringId);const result=await q;const rows=await homeworkChecked(Promise.resolve(result));return {rows,total:result.count,page,hasMore:(result.count??0)>(page+1)*25};},
  save:async(input:{id:string|null;offeringId:string;lessonId:string;segmentId:string|null;revision:number|null;definition:Json;confirmModeChange:boolean})=>({id:await homeworkChecked(client.rpc('save_homework',{p_assignment:input.id,p_offering:input.offeringId,p_lesson:input.lessonId,p_segment:input.segmentId,p_revision:input.revision,p_definition:input.definition,p_confirm_mode_change:input.confirmModeChange}))}),
 };
 return {...service,copyCloneMedia:async(assignmentId:string)=>{
  const raw=await homeworkChecked(client.rpc('homework_upload',{p_assignment:assignmentId,p_action:'clone-tasks'}));
  if(!Array.isArray(raw)||raw.some(v=>!v||typeof v!=='object'||Array.isArray(v)||['id','path','sourcePath','mime'].some(k=>typeof v[k]!=='string')))throw homeworkFailure('Clone media unavailable',503);
  return copyHomeworkCloneTasks(raw as unknown as HomeworkCloneTask[],client.storage.from('lms-homework'),id=>service.finish(assignmentId,id));
 }};
}

import 'server-only';
import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { homeworkDefinition,homeworkAnswers } from '@/shared/contracts/homework';
import { lessonVideo } from '@/shared/contracts/lessons';
import type { Json } from '@/shared/contracts/database.types';
import { homeworkService,homeworkChecked,homeworkFailure } from '@/server/services/homework';
const id=z.string().uuid(),revision=z.number().int().nonnegative();
export async function homeworkPOST(request:NextRequest,{params}:{params:Promise<{assignmentId:string;action:string}>}) {
 if(!isFirebaseStaging()||process.env.LMS_DATA_BACKEND!=='supabase-staging')return NextResponse.json({error:'Not found'},{status:404});
 if(!validFirebaseOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403});
 try {
  const viewer=await getApplicationViewer();if(!viewer||viewer.backend!=='firebase')throw homeworkFailure('Sign in required',401);
  const {assignmentId,action}=await params;if(assignmentId!=='new')id.parse(assignmentId);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw homeworkFailure('JSON required',415);
  const reader=request.body?.getReader();if(!reader)throw homeworkFailure('Body required');let length=0;const parts:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>600000){await reader.cancel();throw homeworkFailure('Request too large',413);}parts.push(value);}
  const body=JSON.parse(Buffer.concat(parts).toString('utf8')),service=await homeworkService();let result:unknown;
  if(action==='list'){const v=z.object({courseId:id,lessonId:id,segmentId:id.nullable(),offeringId:id.nullable(),page:z.number().int().min(0).max(100000).optional()}).strict().parse(body);result=await service.list(v.courseId,v.lessonId,v.segmentId,v.offeringId,v.page??0);}
  else if(action==='offerings'){const v=z.object({courseId:id}).strict().parse(body);const rows=await homeworkChecked(service.client.from('course_offerings').select('id,name').eq('course_id',v.courseId).order('id').limit(101));if(rows.length>100)throw homeworkFailure('This course has more than 100 groups. Narrow group management before authoring.',413);result=rows;}
  else if(action==='save'){const v=z.object({offeringId:id,lessonId:id,segmentId:id.nullable(),revision:revision.nullable(),definition:homeworkDefinition,confirmModeChange:z.boolean()}).strict().parse(body);lessonVideo.parse(v.definition.solutionVideo);result=await service.save({...v,id:assignmentId==='new'?null:assignmentId,definition:v.definition as Json});}
  else if(action==='get'){const v=z.object({submissionId:id.nullable().optional()}).strict().parse(body);result=await service.get(id.parse(assignmentId),v.submissionId??null);}
  else if(action==='lifecycle'){const v=z.object({action:z.enum(['publish','unpublish','clone']),revision}).strict().parse(body);const nextId=await homeworkChecked(service.client.rpc('homework_lifecycle',{p_assignment:id.parse(assignmentId),p_action:v.action,p_revision:v.revision}));result={id:nextId};if(v.action==='clone'){try{result={id:nextId,...await service.copyCloneMedia(nextId)};}catch{result={id:nextId,mediaCopyPending:true,warning:'Draft created. Its solution files still need copying; retry in the editor before publishing.'};}}}
  else if(action==='copy-media'){z.object({}).strict().parse(body);result=await service.copyCloneMedia(id.parse(assignmentId));}
  else if(action==='inbox'){const v=z.object({offeringId:id,assignmentId:id.nullable(),search:z.string().max(200),page:z.number().int().min(0).max(100000)}).strict().parse(body);result=await homeworkChecked(service.client.rpc('homework_inbox',{p_offering:v.offeringId,p_assignment:v.assignmentId,p_search:v.search,p_page:v.page}));}
  else if(action==='revisions'){const v=z.object({page:z.number().int().min(0).max(100000)}).strict().parse(body);result=await homeworkChecked(service.client.rpc('homework_revisions',{p_assignment:id.parse(assignmentId),p_page:v.page}));}
  else if(action==='assignments'){const v=z.object({offeringId:id,search:z.string().max(200),page:z.number().int().min(0).max(100000)}).strict().parse(body);let q=service.client.from('homework_assignments').select('id,title,version,status',{count:'exact'}).eq('offering_id',v.offeringId).order('created_at').order('id').range(v.page*25,v.page*25+24);if(v.search.trim())q=q.ilike('title','%'+v.search.trim().replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')+'%');const r=await q;result={rows:await homeworkChecked(Promise.resolve(r)),total:r.count,page:v.page};}
  else if(action==='history'){const v=z.object({submissionId:id,page:z.number().int().min(0).max(100000)}).strict().parse(body);result=await homeworkChecked(service.client.rpc('homework_history',{p_submission:v.submissionId,p_page:v.page}));}
  else if(action==='work'){
   const base=z.object({action:z.enum(['start','retry','save','submit','grade','release','annotate']),submissionId:id.nullable(),revision:revision.nullable(),data:z.unknown()}).strict().parse(body);let data:unknown;
   if(base.action==='save')data=z.object({answers:homeworkAnswers,fileIds:z.array(id).max(10)}).strict().parse(base.data);
   else if(base.action==='grade')data=z.object({score:z.number().min(0).max(100000).nullable(),feedback:z.string().max(10000),reason:z.string().max(4000),marks:z.array(z.object({questionId:id,points:z.number().min(0).max(1000),feedback:z.string().max(4000)}).strict()).max(100)}).strict().parse(base.data);
   else if(base.action==='release')data=z.object({status:z.enum(['corrected','approved','resubmit_required']),reason:z.string().max(4000)}).strict().parse(base.data);
   else if(base.action==='annotate')data=z.object({id:id.nullable(),annotationRevision:revision.nullable(),fileId:id,page:z.number().int().min(1).max(1000),x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1),note:z.string().trim().min(1).max(4000),reason:z.string().max(4000)}).strict().parse(base.data);
   else data=z.object({}).strict().parse(base.data);
   result=await homeworkChecked(service.client.rpc('homework_work',{p_assignment:id.parse(assignmentId),p_action:base.action,p_submission:base.submissionId,p_revision:base.revision,p_data:data as Json}));
  }else if(action==='upload-intent'){const v=z.object({purpose:z.enum(['reference','question','solution','submission']),submissionId:id.nullable(),name:z.string().trim().min(1).max(200),mime:z.enum(['application/pdf','image/png','image/jpeg','image/webp','video/mp4'])}).strict().parse(body);result=await homeworkChecked(service.client.rpc('homework_upload',{p_assignment:id.parse(assignmentId),p_action:'intent',p_submission:v.submissionId,p_data:{purpose:v.purpose,name:v.name,mime:v.mime}}));}
  else if(['finish-upload','cleanup','media'].includes(action)){const v=z.object({id}).strict().parse(body);result=await service[action==='finish-upload'?'finish':action==='cleanup'?'cleanup':'media'](id.parse(assignmentId),v.id);}
  else throw homeworkFailure('Not found',404);
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){const status=e instanceof z.ZodError||e instanceof SyntaxError?400:(e as {status?:number}).status??503;if(status===503)console.error('Homework operation failed',{name:(e as Error).name,code:(e as {code?:string}).code,frames:(e as Error).stack?.split('\n').slice(1,5)});const reason=status===503?undefined:(e as {reason?:string}).reason;return NextResponse.json({error:status===503?'Homework is unavailable or requires its approved database update.':(e as Error).message,...(reason?{reason}:{})},{status,headers:{'Cache-Control':'no-store'}});}
}

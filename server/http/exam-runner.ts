import 'server-only';
import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { examRunnerService,examFailure } from '@/server/services/exam-runner';
import { examGradingService } from '@/server/services/exam-grading';
import { examAuthoringService } from '@/server/services/exam-authoring';

const answer=z.object({choices:z.array(z.number().int().min(0).max(99)).max(100).optional(),value:z.number().finite().nullable().optional(),choice:z.number().int().min(0).max(99).nullable().optional(),text:z.string().max(5000).nullable().optional(),imageUrl:z.string().max(2048).nullable().optional(),imageKey:z.string().max(256).nullable().optional()}).strict();
const write=z.object({attemptId:z.string().uuid(),revision:z.number().int().nonnegative(),answers:z.record(z.string().uuid(),answer).refine(v=>Object.keys(v).length<=100)}).strict();
export async function examPOST(request:NextRequest,context:{params:Promise<{examId:string;action:string}>}) {
 if(!isFirebaseStaging()||process.env.LMS_DATA_BACKEND!=='supabase-staging')return NextResponse.json({error:'Not found'},{status:404});
 if(!validFirebaseOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const viewer=await getApplicationViewer();if(!viewer||viewer.backend!=='firebase')throw examFailure('Sign in required',401);
  const {examId,action}=await context.params;
  if(!z.string().uuid().safeParse(examId).success||!['state','start','answers','submit','decision','result','photo','grading','grade','release','release-review','definition'].includes(action))throw examFailure('Not found',404);
  if(action==='photo'){
   const type=request.headers.get('content-type')??'';
   if(!['image/png','image/jpeg','image/webp'].includes(type))throw examFailure('Use a PNG, JPEG or WebP photo.',415);
   const attemptId=z.string().uuid().parse(request.headers.get('x-exam-attempt'));
   const questionId=z.string().uuid().parse(request.headers.get('x-exam-question'));
   const reader=request.body?.getReader();if(!reader)throw examFailure('Missing photo');const parts:Uint8Array[]=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5*1024*1024){await reader.cancel();throw examFailure('Photo exceeds 5 MB',413);}parts.push(value);}
   const bytes=Buffer.concat(parts);
   const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
   if(!valid)throw examFailure('Photo content does not match its type.');
   return NextResponse.json(await (await examRunnerService(examId)).photo(attemptId,questionId,new Blob([bytes],{type})),{headers:{'Cache-Control':'no-store'}});
  }
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw examFailure('JSON required',415);
  const reader=request.body?.getReader();if(!reader)throw examFailure('Missing body');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>600000){await reader.cancel();throw examFailure('Request too large',413);}chunks.push(value);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  // The legacy builder's save and clone are closed (owner's answer 2, migration 20261114120000_exams.sql); its definition stays readable.
  if(action==='definition'){
   const service=await examAuthoringService();
   const data=(z.object({}).strict().parse(body),await service.load(examId));
   return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
  }
  if(['grading','grade','release','release-review'].includes(action)){
   const service=await examGradingService(examId);let data;
   if(action==='grading'){const input=z.object({after:z.string().uuid().nullable().optional()}).strict().parse(body);data=await service.load(input.after??null);}
   else if(action==='grade'){const input=z.object({attemptId:z.string().uuid(),revision:z.number().int().nonnegative(),scores:z.record(z.string().uuid(),z.number().finite().nonnegative().max(1000000)),reviewNote:z.string().max(5000),reason:z.string().trim().min(1).max(5000).optional(),requestId:z.string().uuid()}).strict().parse(body);data=await service.grade(input.attemptId,input.revision,input.scores,input.reviewNote,input.reason??null,input.requestId);}
   else {const input=z.object({attemptId:z.string().uuid(),revision:z.number().int().nonnegative()}).strict().parse(body);data=await service.release(input.attemptId,input.revision,action==='release-review');}
   return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
  }
  const service=await examRunnerService(examId);let data;
  if(action==='answers'||action==='submit'){const input=write.parse(body);data=await service[action==='answers'?'save':'submit'](input.attemptId,input.revision,input.answers);}
  else if(action==='decision'){const input=z.object({decision:z.enum(['FINALIZE','RETRY']),revision:z.number().int().nonnegative()}).strict().parse(body);data=await service.decide(input.decision==='RETRY'?'accept':'decline',input.revision);}
  else {z.object({}).strict().parse(body);data=await service[action as 'state'|'start'|'result']();}
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch(error){const status=error instanceof z.ZodError||error instanceof SyntaxError?400:typeof(error as {status?:number}).status==='number'?(error as {status:number}).status:503;return NextResponse.json({error:status===503?'Exam service unavailable. Please retry.':(error as Error).message},{status,headers:{'Cache-Control':'no-store'}});}
}

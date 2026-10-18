import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { academicQuery, academicWrite } from '@/shared/contracts/academics';
import { getApplicationViewer } from '@/server/services/application-auth';
import { academicService } from '@/server/services/academics';
import { validFirebaseOrigin } from '@/server/http/firebase/route';

const reply = (body: unknown,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function academicsHTTP(request: NextRequest) {
 if (!isFirebaseStaging()) return reply({error:'Not found'},404);
 const writing=request.method==='POST';
 if (writing && !validFirebaseOrigin(request)) return reply({error:'Invalid origin'},403);
 try {
  const viewer=await getApplicationViewer();
  if (!viewer || viewer.backend!=='firebase') return reply({error:'Sign in required'},401);
  if (!writing) {
   const params=new URL(request.url).searchParams;
   if (Array.from(params.keys()).some(k=>params.getAll(k).length!==1)) return reply({error:'Invalid query'},400);
   const parsed=academicQuery.safeParse(Object.fromEntries(params));
   if (!parsed.success) return reply({error:'Invalid academic query'},400);
   const q=parsed.data, service=await academicService(viewer.id,q.organizationId);
   return reply(q.kind==='programs' ? await service.programs(q.page) : q.kind==='stages' ? await service.stages(q.programId,q.page) : await service.classification(q.courseId));
  }
  if (request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') return reply({error:'JSON required'},415);
  const reader=request.body?.getReader();if (!reader) return reply({error:'Missing body'},400);
  const chunks:Uint8Array[]=[];let size=0;
  while (true) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();return reply({error:'Request too large'},413);}chunks.push(value); }
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply({error:'Invalid JSON'},400);}
  const input=academicWrite.safeParse(body);if(!input.success)return reply({error:'Invalid academic details'},400);
  return reply(await (await academicService(viewer.id,input.data.organizationId)).write(input.data));
 } catch (error) {
  const status=(error as {status?:number}).status;
  return reply({error:status ? (error as Error).message : 'Academic data is unavailable. Please retry.'},status && [400,403,404,409,503].includes(status)?status:503);
 }
}

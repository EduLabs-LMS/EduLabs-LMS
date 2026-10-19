import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { studentAcademicQuery, studentAcademicWrite } from '@/shared/contracts/student-academics';
import { getApplicationViewer } from '@/server/services/application-auth';
import { studentAcademicService } from '@/server/services/student-academics';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function studentAcademicsHTTP(request:NextRequest) {
 if(!isFirebaseStaging())return reply({error:'Not found'},404);
 if(request.method==='POST'&&!validFirebaseOrigin(request))return reply({error:'Invalid origin'},403);
 try {
  const viewer=await getApplicationViewer();
  if(!viewer||viewer.backend!=='firebase')return reply({error:'Sign in required'},401);
  if(request.method==='GET') {
   const params=new URL(request.url).searchParams;
   if(Array.from(params.keys()).some(k=>params.getAll(k).length!==1))return reply({error:'Invalid query'},400);
   const parsed=studentAcademicQuery.safeParse(Object.fromEntries(params));
   if(!parsed.success)return reply({error:'Invalid academic query'},400);
   return reply(await(await studentAcademicService(viewer.id)).catalog(parsed.data.organizationId));
  }
  if(new URL(request.url).search)return reply({error:'Unexpected query'},400);
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply({error:'JSON required'},415);
  const reader=request.body?.getReader();if(!reader)return reply({error:'Missing body'},400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return reply({error:'Request too large'},413);}chunks.push(value);}
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply({error:'Invalid JSON'},400);}
  const input=studentAcademicWrite.safeParse(body);if(!input.success)return reply({error:'Invalid preference'},400);
  return reply(await(await studentAcademicService(viewer.id)).save(input.data));
 }catch(error){const status=(error as {status?:number}).status;const known=status&&[400,403,404,409,503].includes(status);return reply({error:known?(error as Error).message:'Academic choices are unavailable. Please retry.'},known?status:503);}
}

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getApplicationViewer } from '@/server/services/application-auth';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { legacyPersonalizationWrite,settingsResponse } from '@/shared/contracts/settings';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
const failed=(message:string,status:number)=>Object.assign(new Error(message),{status});
export async function personalizationHTTP(request:Request){
 const write=request.method==='PUT';
 try{
  if(write&&!validFirebaseOrigin(request as NextRequest))throw failed('Invalid origin',403);
  if(new URL(request.url).search)throw failed('Unexpected settings query.',400);
  const viewer=await getApplicationViewer();if(!viewer)throw failed('Sign in required.',401);
  const firebase=isFirebaseStaging();if(viewer.backend!==(firebase?'firebase':'clerk'))throw failed('Sign in required.',401);
  let body:unknown;
  if(write){
   if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw failed('JSON required.',415);
   const reader=request.body?.getReader();if(!reader)throw failed('Body required.',400);const chunks:Uint8Array[]=[];let bytes=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();throw failed('Settings request is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failed('Invalid settings JSON.',400);}
  }
  if(firebase){
   if(process.env.LMS_DATA_BACKEND!=='supabase-staging')throw failed('Settings are unavailable. Check the application configuration.',503);
   if(write)throw failed('No configurable application settings are available.',400);
   return reply(settingsResponse.parse({kind:'application',settings:[]}));
  }
  // The original Clerk records remain scoped to that identity. Firebase never reaches Prisma.
  const {db}=await import('@/server/db');
  if(write){const input=legacyPersonalizationWrite.safeParse(body);if(!input.success)throw failed('Check the legacy dashboard preferences.',400);const saved=await db.personalization.upsert({where:{userId:viewer.id},update:{dashboard:input.data.dashboard},create:{userId:viewer.id,dashboard:input.data.dashboard}});return reply(saved);}
  const saved=await db.personalization.findUnique({where:{userId:viewer.id}});
  return reply(saved);
 }catch(error){const status=(error as {status?:number}).status;return reply({error:status&&[400,401,403,413,415,503].includes(status)?(error as Error).message:'Settings could not be loaded or saved. Please retry.'},status&&[400,401,403,413,415,503].includes(status)?status:503);}
}
export const GET=personalizationHTTP;
export const PUT=personalizationHTTP;

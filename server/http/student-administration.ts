import 'server-only';
import { NextRequest,NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { studentAdministration } from '@/server/services/student-administration';
import { studentAdminData,studentAdminEnvelope,studentAdminReadActions } from '@/shared/contracts/student-administration';
import type { Json } from '@/shared/contracts/database.types';
export async function studentAdministrationPOST(request:NextRequest){
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
 if(!isFirebaseStaging()||process.env.LMS_DATA_BACKEND!=='supabase-staging')return NextResponse.json({error:'Not found'},{status:404,headers});
 if(!validFirebaseOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const viewer=await getApplicationViewer();if(!viewer||viewer.backend!=='firebase')throw Object.assign(Error('Sign in required'),{status:401});
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Object.assign(Error('JSON required'),{status:415});
  const reader=request.body?.getReader();if(!reader)throw Object.assign(Error('Body required'),{status:400});let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();throw Object.assign(Error('Request too large'),{status:413});}chunks.push(value);}
  const v=studentAdminEnvelope.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),data=studentAdminData(v.action,v.data);
  if(!studentAdminReadActions.includes(v.action)&&!v.requestId)throw Object.assign(Error('Request ID required'),{status:400});
  return NextResponse.json(await studentAdministration(v.action,data as Json,v.offeringId??null,v.subjectId??null,v.version??null,v.requestId??null),{headers});
 }catch(e){const status=e instanceof ZodError||e instanceof SyntaxError?400:(e as {status?:number}).status??503;return NextResponse.json({error:status===400?'Check the entered details.':status===503?'Student administration is temporarily unavailable.':(e as Error).message},{status,headers});}
}

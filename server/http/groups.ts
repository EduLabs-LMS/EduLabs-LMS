import 'server-only';
import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { groupService,groupFailure } from '@/server/services/groups';
import { groupDefinition,groupEdit,groupRead,sessionDefinition } from '@/shared/contracts/groups';
import type { Json } from '@/shared/contracts/database.types';
const id=z.string().uuid(),reason=z.string().trim().min(3).max(1000),version=z.number().int().nonnegative();
export async function groupsPOST(request:NextRequest){
 if(!isFirebaseStaging()||process.env.LMS_DATA_BACKEND!=='supabase-staging')return NextResponse.json({error:'Not found'},{status:404});
 if(!validFirebaseOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const viewer=await getApplicationViewer();if(!viewer||viewer.backend!=='firebase')throw groupFailure('Sign in required',401);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw groupFailure('JSON required',415);
  const reader=request.body?.getReader();if(!reader)throw groupFailure('Body required');let size=0;const parts:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw groupFailure('Request too large',413);}parts.push(value);}
  const envelope=z.object({action:z.string().max(20),groupId:id.nullable(),version:version.nullable().optional(),data:z.record(z.unknown()).default({})}).strict().parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
  const service=await groupService();let result:unknown;const {action,groupId}=envelope;let data:unknown;
  if(action==='view'){const v=groupRead.parse({groupId,...envelope.data});if(!['sessions','detail','offerings','upcoming','members','eligible','staff','history','audit','summary'].includes(v.section)&&!(v.section.startsWith('offering:')&&id.safeParse(v.section.slice(9)).success)&&!id.safeParse(v.section).success)throw groupFailure('Invalid view');result=await service.view(v.groupId,v.section,v.page,v.search);}
  else {
   if(action!=='create'&&!groupId)throw groupFailure('Group required');
   if(action==='create'){const v=z.object({offeringId:id,definition:groupDefinition}).strict().parse(envelope.data);data={offeringId:v.offeringId,...v.definition};}
   else if(action==='edit')data=groupEdit.parse(envelope.data);
   else if(['archive','unarchive'].includes(action))data=z.object({}).strict().parse(envelope.data);
   else if(action==='staff')data=z.object({userId:id,remove:z.boolean()}).strict().parse(envelope.data);
   else if(['add','remove','transfer'].includes(action))data=z.object({userId:id,targetGroupId:id.optional(),reason:z.string().max(1000).optional()}).strict().parse(envelope.data);
   else if(action==='one-off')data=sessionDefinition.parse(envelope.data);
   else if(action==='session')data=z.object({sessionId:id,sessionVersion:version,operation:z.enum(['reschedule','cancel','restore']),startsAt:z.string().datetime({offset:true}).optional(),endsAt:z.string().datetime({offset:true}).optional(),reason:z.string().max(1000).optional()}).strict().parse(envelope.data);
   else if(['attendance','finalize','reopen'].includes(action))data=z.object({sessionId:id,sessionVersion:version,marks:z.array(z.object({userId:id,status:z.enum(['not_marked','attended','absent'])}).strict()).max(100).optional(),reason:reason.optional()}).strict().parse(envelope.data);
   else throw groupFailure('Not found',404);
   result=await service.command(groupId,action,envelope.version??null,data as Json);
  }
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){const status=e instanceof z.ZodError||e instanceof SyntaxError?400:(e as {status?:number}).status??503;return NextResponse.json({error:status===400?'Check the entered details.':status===503?'Groups are temporarily unavailable or require their approved database update.':(e as Error).message},{status,headers:{'Cache-Control':'no-store'}});}
}

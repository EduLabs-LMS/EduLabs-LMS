import 'server-only';
import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { accountNames,avatarLimit } from '@/shared/contracts/account';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { accountService,accountFailure } from '@/server/services/account';
export async function accountPOST(request:NextRequest){
 if(!isFirebaseStaging()||process.env.LMS_DATA_BACKEND!=='supabase-staging')return NextResponse.json({error:'Not found'},{status:404});
 if(!validFirebaseOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const viewer=await getApplicationViewer();if(!viewer||viewer.backend!=='firebase')throw accountFailure('Verified sign-in required',401);
  const upload=new URL(request.url).pathname.endsWith('/avatar'),reader=request.body?.getReader();if(!reader)throw accountFailure('Body required');const parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>(upload?avatarLimit:8000)){await reader.cancel();throw accountFailure('Request too large',413);}parts.push(value);}
  const service=await accountService();let result;
  if(upload){const raw=request.headers.get('x-profile-revision');if(!raw||!/^\d+$/.test(raw))throw accountFailure('Profile revision required');const revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(Number(raw));result=await service.upload(Buffer.concat(parts),request.headers.get('content-type')??'',revision);}
  else{
   if(!request.headers.get('content-type')?.startsWith('application/json'))throw accountFailure('JSON required',415);
   const v=z.object({action:z.enum(['get','save','remove-avatar','provider-avatar','cleanup']),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null),data:z.unknown().optional()}).strict().parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
   if(v.action==='save'){const values=accountNames.extend({completeOnboarding:z.boolean()}).strict().parse(v.data);await service.command('save',v.revision,values);result=await service.read();}
   else if(v.action==='remove-avatar'){await service.command('remove-avatar',v.revision);let pending=true;try{pending=await service.cleanup();}catch{}result={...await service.read(),cleanupPending:pending};}
   else if(v.action==='provider-avatar'){if(v.revision===null)throw accountFailure('Profile revision required');result=await service.providerAvatar(v.revision);}
   else if(v.action==='cleanup')result={...await service.read(),cleanupPending:await service.cleanup()};
   else result=await service.read();
  }
  return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){const status=e instanceof z.ZodError||e instanceof SyntaxError?400:(e as {status?:number}).status??503;return NextResponse.json({error:status===503?'Account settings are unavailable or require their approved database update.':status===400?'Check your profile details and image.':(e as Error).message},{status,headers:{'Cache-Control':'no-store'}});}
}

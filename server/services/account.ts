import 'server-only';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/shared/supabase-config';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { getFirebaseAdminAuth } from '@/server/integrations/firebase-admin';
import { getFirebaseSession } from '@/server/services/firebase-auth';
import { avatarLimit,avatarTypes,providerPhoto } from '@/shared/contracts/account';
import type { AccountProfile } from '@/shared/contracts/account';
import type { Database,Json } from '@/shared/contracts/database.types';
export const accountFailure=(message:string,status=400)=>Object.assign(Error(message),{status});
export async function accountChecked<T>(query:PromiseLike<{data:T|null;error:{code?:string}|null}>){const {data,error}=await query;if(error||data===null){const status=error?.code==='42501'?403:error?.code==='PT409'?409:['23514','23505','22P02','23502'].includes(error?.code??'')?400:503;throw accountFailure(status===409?'Your account changed. Reload before saving.':status===403?'Account access denied.':status===400?'Check the account details or finish pending photo cleanup.':'Account settings require their approved database update or are temporarily unavailable.',status);}return data;}
export async function normalizeAvatar(bytes:Buffer,mime:string){
 if(!avatarTypes.includes(mime as typeof avatarTypes[number])||!bytes.length||bytes.length>avatarLimit)throw accountFailure('Choose a PNG, JPEG or WebP image up to 3 MB.');
 const signature=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!signature)throw accountFailure('The image content does not match its file type.');
 try{const image=sharp(bytes,{limitInputPixels:16000000,failOn:'error',animated:false});const info=await image.metadata();if(!info.width||!info.height||(info.pages??1)>1)throw Error('Invalid image');const result=await image.rotate().resize(512,512,{fit:'cover',withoutEnlargement:true}).webp({quality:85}).toBuffer();if(result.length>1048576)throw Error('Oversized image');return result;}catch{throw accountFailure('The image is corrupted, animated or too large. Choose a static image.');}
}
export async function accountService(){
 const client=await getSupabaseServerClient();
 const command=async(action:string,revision:number|null=null,data:Json={})=>accountChecked(client.rpc('account_profile',{p_action:action,p_revision:revision,p_data:data}));
 async function read(){const raw=await command('get') as unknown as AccountProfile&{avatarPath:string|null};let avatarUrl:string|null=null,avatarError:string|undefined;if(raw.avatarPath){const signed=await client.storage.from('lms-avatars').createSignedUrl(raw.avatarPath,90);if(signed.error)avatarError='Your saved photo could not be loaded. You can replace or remove it.';else avatarUrl=signed.data?.signedUrl??null;}const {avatarPath:_,...profile}=raw;return {...profile,avatarUrl,avatarError};}
 async function cleanup(){const rows=await command('cleanup');if(!Array.isArray(rows))throw accountFailure('Photo cleanup unavailable',503);let pending=false;for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||typeof row.path!=='string')throw accountFailure('Photo cleanup unavailable',503);const removed=await client.storage.from('lms-avatars').remove([row.path]);if(removed.error){pending=true;continue;}await command('prune-avatar',null,{id:row.id});}return pending;}
 async function upload(bytes:Buffer,mime:string,revision:number){
  const normalized=await normalizeAvatar(bytes,mime),sha256=createHash('sha256').update(normalized).digest('hex');
  const intent=await command('begin-avatar',revision,{size:normalized.length,sha256}) as {id:string;path:string};
  try{
   const session=await getFirebaseSession();if(!session?.identity.email_verified)throw accountFailure('Verified session required',401);
   // Same trusted, exact-upload attestation boundary used by Homework. Never expose
   // this short-lived token or persist these claims on the Firebase account.
   const token=await getFirebaseAdminAuth().createCustomToken(session.identity.uid,{role:'authenticated',avatar_upload:{id:intent.id,size:normalized.length,sha256,issuedAt:Math.floor(Date.now()/1000)}});
   const exchange=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(process.env.NEXT_PUBLIC_FIREBASE_API_KEY??'')}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,returnSecureToken:true}),cache:'no-store'});
   const value=await exchange.json();if(!exchange.ok||typeof value.idToken!=='string')throw accountFailure('Private photo verification is unavailable. Retry.',503);
   const {url,publishableKey}=getSupabaseConfig();const verified=createClient<Database>(url,publishableKey,{accessToken:async()=>value.idToken,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const stored=await verified.storage.from('lms-avatars').upload(intent.path,normalized,{contentType:'image/webp',upsert:false});if(stored.error)throw accountFailure('Private photo upload failed. Retry.',503);
   await accountChecked(verified.rpc('account_profile',{p_action:'commit-avatar',p_revision:revision,p_data:{id:intent.id}}));
  }catch(error){try{await command('abort-avatar',null,{id:intent.id});await cleanup();}catch{/* Owner can retry cleanup; never delete active photos. */}throw error;}
  let pending=true;try{pending=await cleanup();}catch{/* Reference is saved; cleanup remains explicitly recoverable. */}
  return {...await read(),cleanupPending:pending};
 }
 return {read,upload,command,cleanup,providerAvatar:async(revision:number)=>{
  const session=await getFirebaseSession();if(!session)throw accountFailure('Sign in required',401);const user=await getFirebaseAdminAuth().getUser(session.identity.uid);const url=providerPhoto(user.photoURL??null);if(!url)throw accountFailure('No supported provider photo is available. Choose your own image.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});if(!response.ok||!response.body)throw accountFailure('Provider photo unavailable. Choose your own image.');const parts:Uint8Array[]=[];let size=0;const reader=response.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>avatarLimit){await reader.cancel();throw accountFailure('Provider photo exceeds 3 MB.');}parts.push(value);}return upload(Buffer.concat(parts),response.headers.get('content-type')?.split(';')[0]??'',revision);
 }};
}

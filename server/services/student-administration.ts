import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import type { Json } from '@/shared/contracts/database.types';
export async function studentAdministration<T=unknown>(action:string, data:Json={},offeringId:string|null=null,subjectId:string|null=null,version:number|null=null,requestId:string|null=null):Promise<T>{
 const client=await getSupabaseServerClient();const r=await client.rpc('student_administration',{p_action:action,p_data:data,p_offering:offeringId,p_subject:subjectId,p_version:version,p_request:requestId});
 if(r.error||r.data===null){const code=r.error?.code,status=code==='42501'?403:code==='PT409'?409:code==='PT429'?429:['23514','23505','23502','22P02','22007','22008'].includes(code??'')?400:503;throw Object.assign(Error(status===403?'Access unavailable or permission denied.':status===409?'This record changed. Refresh before trying again.':status===429?'Too many requests. Please try later.':status===400?'Check the details and existing access.':'Student administration is unavailable or requires its approved database update.'),{status});}return r.data as T;
}

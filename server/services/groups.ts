import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import type { GroupPage,StudyGroup } from '@/shared/contracts/groups';
import type { Json } from '@/shared/contracts/database.types';
import { groupRefusal, type GroupRefusal } from '@/shared/teacher-groups';
export const groupFailure=(message:string,status=400,reason?:GroupRefusal)=>Object.assign(new Error(message),{status},reason?{reason}:{});
export async function groupService(){
 const client=await getSupabaseServerClient();
 async function checked(q:PromiseLike<{data:Json|null;error:{code?:string;message?:string}|null}>){const {data,error}=await q;if(error||data===null){const status=error?.code==='42501'?403:error?.code==='PT409'?409:['23514','23505','22P02','22007','22008','23502'].includes(error?.code??'')?400:503;throw groupFailure(status===403?'Group unavailable or permission denied.':status===409?'This record changed. Reload before saving.':status===400?'Check membership, capacity, schedule and attendance state.':'Groups are unavailable or require the approved database update.',status,status===400?groupRefusal(error?.message):undefined);}return data;}
 return {
  view:async<T>(groupId:string|null,section='sessions',page=0,search='')=>await checked(client.rpc('group_view',{p_group:groupId,p_section:section,p_page:page,p_search:search})) as unknown as GroupPage<T>,
  command:async(groupId:string|null,action:string,version:number|null,data:Json)=>checked(client.rpc('group_command',{p_group:groupId,p_action:action,p_version:version,p_data:data})),
  overview:async()=>await checked(client.rpc('group_view',{})) as unknown as GroupPage<StudyGroup>,
 };
}

import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { academicFailure, academicResult } from '@/server/services/academics';
import { websiteConfig, publicCatalogDto } from '@/shared/contracts/teacher-websites';
import type { WebsiteWrite, WebsiteEditorState, EditorWebsite } from '@/shared/contracts/website-editor';
import type { Database, Json } from '@/shared/contracts/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Explicit scoped additions to generated foundation types; no unrelated type regeneration.
type Table<Row>={Row:Row;Insert:Partial<Row>;Update:Partial<Row>;Relationships:[]};
type WebsiteDatabase=Database & {public:{Tables:{
 organization_websites:Table<EditorWebsite>;
 website_catalog_entries:Table<{website_id:string;organization_id:string;course_id:string;title:string;summary:string;asset_id:string|null}>;
 website_stage_selections:Table<{website_id:string;organization_id:string;stage_id:string}>;
};Functions:{teacher_website_command:{Args:{p_action:string;p_organization_id:string;p_revision:number;p_data:Json};Returns:Json};public_teacher_catalog:{Args:{p_slug:string;p_limit:number;p_after?:string};Returns:Json}}}};
export async function websiteEditorService(userId:string,organizationId:string) {
 const client=await getSupabaseServerClient() as SupabaseClient<WebsiteDatabase>;
 const [members,orgs]=await Promise.all([
  academicResult(client.from('organization_memberships').select('role').eq('organization_id',organizationId).eq('user_id',userId).eq('status','active').limit(1)),
  academicResult(client.from('organizations').select('id').eq('id',organizationId).eq('status','active').limit(1)),
 ]);
 if(!members[0]||!orgs[0])throw academicFailure('Website access is not available in this organization.',403);
 const canManage=['owner','admin'].includes(members[0].role);
 // Range through PostgREST's row cap. A failed/incomplete response is never an empty state.
 async function all<T>(query:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:{code?:string}|null}>):Promise<T[]> {
  const result:T[]=[];for(let offset=0;offset<10000;offset+=200){const rows=await academicResult(query(offset,offset+199));result.push(...rows);if(rows.length<200)return result;}
  throw academicFailure('This organization exceeds the editor selection limit. Contact support.',503);
 }
 return {
  async read():Promise<WebsiteEditorState> {
   const sites=await academicResult(client.from('organization_websites').select('id,organization_id,slug,status,revision,draft_config,updated_at').eq('organization_id',organizationId).limit(1));
   const raw=sites[0];const website=raw?{...raw,draft_config:websiteConfig.parse(raw.draft_config)}:null;
   const [courses,stages,programs,assignments,catalog,selections]=await Promise.all([
    all((a,b)=>client.from('courses').select('id,title,status,visibility').eq('organization_id',organizationId).order('id').range(a,b)),
    all((a,b)=>client.from('academic_stages').select('id,label,status,program_id,position').eq('organization_id',organizationId).order('position').order('id').range(a,b)),
    all((a,b)=>client.from('academic_programs').select('id,label,status,position').eq('organization_id',organizationId).order('position').order('id').range(a,b)),
    all((a,b)=>client.from('course_stage_assignments').select('course_id,stage_id').eq('organization_id',organizationId).order('course_id').order('stage_id').range(a,b)),
    all((a,b)=>client.from('website_catalog_entries').select('course_id,title,summary,asset_id').eq('organization_id',organizationId).order('course_id').range(a,b)),
    all((a,b)=>client.from('website_stage_selections').select('stage_id').eq('organization_id',organizationId).order('stage_id').range(a,b)),
   ]);
   let published:WebsiteEditorState['published']=null;
   if(website?.status==='published') {
    let after:string|undefined;const seen=new Set<string>(),pages:NonNullable<WebsiteEditorState['published']>[]=[];
    do {const result=publicCatalogDto.parse(await academicResult(client.rpc('public_teacher_catalog',{p_slug:website.slug,p_limit:50,...(after?{p_after:after}:{})})));
     if(pages.length&&pages[0].version!==result.version)throw academicFailure('Publication changed while loading. Reload the editor.',409);
     pages.push(result);
     if(pages.length>4||pages.reduce((n,p)=>n+p.courses.length,0)>200)throw academicFailure('Public catalog exceeds its expected bound.',503);
     if(result.hasMore&&(!result.next||seen.has(result.next)))throw academicFailure('Incomplete public preview.',503);
     after=result.hasMore?result.next??undefined:undefined;if(after)seen.add(after);
    }while(after);
    published={...pages[0],courses:pages.flatMap(p=>p.courses),hasMore:false,next:null};
   }
   return {canManage,website,courses,stages,programs,assignments,catalog:catalog.map(c=>({id:c.course_id,title:c.title,summary:c.summary,assetId:c.asset_id})),selectedStages:selections.map(s=>s.stage_id),published,uploadsEnabled:false};
  },
  async write(input:WebsiteWrite) {
   if(input.organizationId!==organizationId||!canManage)throw academicFailure('Only an organization owner or admin can manage this website.',403);
   const {error}=await client.rpc('teacher_website_command',{p_action:input.action,p_organization_id:organizationId,p_revision:input.revision,p_data:input.data as Json});
   if(error){const code=error.code;throw academicFailure(code==='PT409'?'The website changed in another tab. Your draft is retained; reload before saving.':code==='23505'?'That website slug is already in use.':code==='42501'?'Permission denied or selected content is no longer eligible.':code==='55P03'?'Permissions are changing. Retry shortly.':'Unable to save. Check the website copy and publication requirements.',code==='PT409'||code==='23505'?409:code==='42501'?403:code==='55P03'?503:400);}
   return {saved:true};
  },
 };
}

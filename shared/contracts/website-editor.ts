import { z } from 'zod';
import { websiteConfig, publicCatalogDto } from './teacher-websites';
const uuid=z.string().uuid(), revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const plain=(max:number)=>z.string().max(max).regex(/^[^<>\u0000-\u001f\u007f]*$/);
export const catalogEntry=z.object({id:uuid,title:plain(160).refine(v=>!!v.trim()),summary:plain(1200),assetId:uuid.nullable()}).strict();
const scope={organizationId:uuid,revision};
export const websiteWrite=z.discriminatedUnion('action',[
 z.object({...scope,action:z.literal('create'),data:z.object({slug:z.string().min(3).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).refine(v=>!['admin','api','auth','www','staging','support','edulabs','localhost'].includes(v)),config:websiteConfig}).strict()}).strict(),
 z.object({...scope,action:z.literal('draft'),data:z.object({config:websiteConfig}).strict()}).strict(),
 z.object({...scope,action:z.literal('catalog'),data:z.object({courses:z.array(catalogEntry).max(200).refine(v=>new Set(v.map(c=>c.id)).size===v.length),stages:z.array(uuid).max(100).refine(v=>new Set(v).size===v.length)}).strict()}).strict(),
 z.object({...scope,action:z.literal('publish'),data:z.object({}).strict()}).strict(),
 z.object({...scope,action:z.literal('unpublish'),data:z.object({}).strict()}).strict(),
]);
export const websiteQuery=z.object({organizationId:uuid}).strict();
export type WebsiteWrite=z.infer<typeof websiteWrite>;
export type WebsiteConfig=z.infer<typeof websiteConfig>;
export type CatalogEntry=z.infer<typeof catalogEntry>;
export type EditorWebsite={id:string;organization_id:string;slug:string;status:string;revision:number;draft_config:WebsiteConfig;updated_at:string};
export type EditorCourse={id:string;title:string;status:string;visibility:string};
export type EditorStage={id:string;label:string;status:string;program_id:string;position:number};
export type EditorProgram={id:string;label:string;status:string;position:number};
export type WebsiteEditorState={canManage:boolean;website:EditorWebsite|null;courses:EditorCourse[];stages:EditorStage[];programs:EditorProgram[];assignments:{course_id:string;stage_id:string}[];catalog:CatalogEntry[];selectedStages:string[];published:z.infer<typeof publicCatalogDto>|null;uploadsEnabled:false};
export const initialWebsiteConfig:WebsiteConfig={displayName:'',heroTitle:'',heroSubtitle:'',about:'',locale:'en',theme:'green',accent:'green',ctaLabel:'Join the classroom',ctaTarget:'sign-up',sections:['hero','about','programs','courses']};
/** Draft simulation uses the same publication boundaries. Public snapshot comes from the actual projection RPC. */
export function draftWebsitePreview(state:WebsiteEditorState,config:WebsiteConfig,catalog:CatalogEntry[],selectedStages:string[]) {
 const stages=state.stages.filter(s=>selectedStages.includes(s.id)&&s.status==='active'&&state.programs.some(p=>p.id===s.program_id&&p.status==='active'));
 const courses=catalog.filter(e=>state.courses.some(c=>c.id===e.id&&c.status==='published'&&c.visibility==='public')).map(e=>({...e,stageIds:state.assignments.filter(a=>a.course_id===e.id&&stages.some(s=>s.id===a.stage_id)).map(a=>a.stage_id)}));
 const blockers=[...catalog.filter(e=>!courses.some(c=>c.id===e.id)).map(e=>`Course “${e.title}” is not published and public, or is unavailable.`),...selectedStages.filter(id=>!stages.some(s=>s.id===id)).map(()=> 'A selected stage or program is archived or unavailable.')];
 if(!websiteConfig.safeParse(config).success)blockers.push('Complete the required website copy with supported plain text.');
 if(config.logoAssetId||config.heroAssetId||catalog.some(e=>e.assetId))blockers.push('Image preview is pending the trusted asset-delivery adapter.');
 return {site:config,stages:stages.map(s=>({...s,programLabel:state.programs.find(p=>p.id===s.program_id)!.label})),courses,blockers};
}

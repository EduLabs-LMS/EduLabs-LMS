import { z } from 'zod';
import type { PublicTeacherCatalog } from './contracts/teacher-websites';
const slug=z.string().min(3).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),uuid=z.string().uuid().transform(v=>v.toLowerCase());
export const visitorQuery=z.object({stage:uuid.optional(),after:uuid.optional(),limit:z.enum(['6','12','24']).default('12')}).strict();
export type VisitorQuery=z.infer<typeof visitorQuery>;
export function publicWebsiteRoute(path:string):{slug:string;kind:'home'|'course'|'sitemap';courseId?:string}|null {
 const parts=path.split('/');if(parts[0]!==''||parts[1]!=='t'||!slug.safeParse(parts[2]).success)return null;
 if(parts.length===3)return{slug:parts[2],kind:'home'};
 if(parts.length===4&&parts[3]==='sitemap.xml')return{slug:parts[2],kind:'sitemap'};
 const id=uuid.safeParse(parts[4]);
 if(parts.length===5&&parts[3]==='courses'&&id.success)return{slug:parts[2],kind:'course',courseId:id.data};
 return null;
}
export function publicWebsitePath(slugValue:string,courseId?:string){
 if(!slug.safeParse(slugValue).success||(courseId&&!uuid.safeParse(courseId).success))throw Error('Invalid public path');
 return '/t/'+slugValue+(courseId?'/courses/'+uuid.parse(courseId):'');
}
export function publicCatalogHref(site:string,query:Partial<VisitorQuery>={}) {
 const parsed=visitorQuery.parse(query),p=new URLSearchParams();if(parsed.stage)p.set('stage',parsed.stage);if(parsed.after)p.set('after',parsed.after);if(parsed.limit!=='12')p.set('limit',parsed.limit);
 return publicWebsitePath(site)+(p.size?'?'+p.toString():'')+'#courses';
}
export function publicPlatformOrigin(value:string|undefined,development=false):string {
 const u=new URL(value??'');if(u.origin!==value||u.username||u.password||(!['https:'].includes(u.protocol)&&!(development&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw Error('Configure an exact trusted HTTPS APP_ORIGIN.');return u.origin;
}
export function publicAuthLinks(origin:string,site:string){
 const base=publicPlatformOrigin(origin,origin.startsWith('http://'));
 // The existing access screen still needs a valid teacher invitation. A slug is never an invitation.
 const target='/access';return{signin:new URL('/sign-in?next='+encodeURIComponent(target),base).href,signup:new URL('/sign-up?next='+encodeURIComponent(target),base).href,access:new URL(target,base).href,home:new URL(publicWebsitePath(site),base).href};
}
export function validatePublicPage(value:PublicTeacherCatalog,site:string,limit:number,after?:string,stage?:string,courseId?:string){
 if(value.slug!==site||value.courses.length>limit||value.stages.length>100||value.hasMore&&(!value.next||value.next!==value.courses.at(-1)?.id)||!value.hasMore&&value.next!==null)throw Error('Incomplete public catalog');
 const ids=value.courses.map(c=>c.id);if(new Set(ids).size!==ids.length||ids.some((id,i)=>after&&id<=after||i>0&&id<=ids[i-1])||courseId&&(ids.length!==1||ids[0]!==courseId))throw Error('Invalid catalog ordering');
 const stages=new Set(value.stages.map(s=>s.id));if(stages.size!==value.stages.length||stage&&!stages.has(stage)||value.courses.some(c=>new Set(c.stageIds).size!==c.stageIds.length||c.stageIds.some(s=>!stages.has(s))||stage&&!c.stageIds.includes(stage)))throw Error('Invalid public classification');
 return value;
}

import 'server-only';
import { z } from 'zod';
import { anonymousCatalogClient } from '@/server/integrations/public-catalog';
import { publicCatalogDto } from '@/shared/contracts/teacher-websites';
import { validatePublicPage, publicPlatformOrigin } from '@/shared/public-website';
import type { VisitorQuery } from '@/shared/public-website';
export const publicFailure=(message:string,status:number)=>Object.assign(new Error(message),{status});
export function publicRequestOrigin(request:Request){
 let origin:string;try{origin=publicPlatformOrigin(process.env.APP_ORIGIN,process.env.NODE_ENV==='development');}catch{throw publicFailure('Public website configuration is unavailable.',503);}
 const expected=new URL(origin).host.toLowerCase(),host=request.headers.get('host')?.toLowerCase();
 const additional=(process.env.PUBLIC_WEBSITE_ALLOWED_HOSTS??'').split(',').filter(Boolean);
 if(additional.length>5||additional.some(v=>!/^([a-z0-9.-]+|\[[a-f0-9:]+\])(:[0-9]{1,5})?$/.test(v)))throw publicFailure('Public website configuration is unavailable.',503);
 if(!host||![expected,...additional].includes(host))throw publicFailure('Use the configured platform website address.',421);
 // X-Forwarded-Host/Forwarded never determine the origin, links, organization or data scope.
 return origin;
}
/** External durable gateway contract. Missing/failing enforcement fails closed; no process counters or client IP headers. */
export async function allowPublicRequest(site:string,cost:number){
 const endpoint=process.env.PUBLIC_WEBSITE_RATE_LIMIT_URL,token=process.env.PUBLIC_WEBSITE_RATE_LIMIT_TOKEN;
 if(!endpoint||!token)throw publicFailure('Public browsing is awaiting gateway configuration.',503);
 let url:URL;try{url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error();}catch{throw publicFailure('Public browsing is awaiting gateway configuration.',503);}
 try{const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({bucket:'edulabs-public-websites',site,cost}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw Error();const text=await r.text();if(text.length>1024)throw Error();const verdict=z.object({allowed:z.boolean(),retryAfterSeconds:z.number().int().min(1).max(3600)}).strict().parse(JSON.parse(text));
  if(!verdict.allowed)throw Object.assign(publicFailure('Too many requests. Please try again shortly.',429),{retryAfter:verdict.retryAfterSeconds});
 }catch(e){if((e as {status?:number}).status===429)throw e;throw publicFailure('Public browsing is temporarily unavailable. Please retry.',503);}
}
export async function readPublicWebsite(site:string,query:VisitorQuery,courseId?:string){
 const client=anonymousCatalogClient(),limit=courseId?1:Number(query.limit);
 const args={p_slug:site,p_limit:limit,...(query.stage?{p_stage_id:query.stage}:{}),...(query.after?{p_after:query.after}:{}),...(courseId?{p_course_id:courseId}:{})};
 const {data,error}=await client.rpc('public_teacher_catalog',args);if(error)throw publicFailure('The public catalog is temporarily unavailable.',503);if(data===null)throw publicFailure('Website or course not found.',404);
 let parsed;try{parsed=validatePublicPage(publicCatalogDto.parse(data),site,limit,query.after,query.stage,courseId);}catch{throw publicFailure('The public catalog response is incomplete. Please retry.',503);}
 if(query.after){const cursor=await client.rpc('public_teacher_catalog',{p_slug:site,p_limit:1,p_course_id:query.after,...(query.stage?{p_stage_id:query.stage}:{})});
  if(cursor.error)throw publicFailure('The public catalog is temporarily unavailable.',503);
  if(!cursor.data)throw publicFailure('This catalog page has changed. Return to the first page.',400);
  let previous;try{previous=validatePublicPage(publicCatalogDto.parse(cursor.data),site,1,undefined,query.stage,query.after);}catch{throw publicFailure('The public catalog response is incomplete.',503);}
  if(previous.version!==parsed.version)throw publicFailure('This website changed. Return to the first page.',409);
 }
 return parsed;
}
export async function publicSitemap(site:string){
 const client=anonymousCatalogClient();let after:string|undefined,version:string|undefined;const ids:string[]=[];
 for(let page=0;page<4;page++){
  const {data,error}=await client.rpc('public_teacher_catalog',{p_slug:site,p_limit:50,...(after?{p_after:after}:{})});if(error)throw publicFailure('Sitemap is temporarily unavailable.',503);if(!data)throw publicFailure('Website not found.',404);
  let parsed;try{parsed=validatePublicPage(publicCatalogDto.parse(data),site,50,after);}catch{throw publicFailure('Sitemap response is incomplete.',503);}
  if(version&&version!==parsed.version)throw publicFailure('Sitemap changed. Please retry.',503);version=parsed.version;ids.push(...parsed.courses.map(c=>c.id));
  if(!parsed.hasMore)return ids;after=parsed.next!;
 }
 throw publicFailure('Sitemap exceeds the expected catalog bound.',503);
}

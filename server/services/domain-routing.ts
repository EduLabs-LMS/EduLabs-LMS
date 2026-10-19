import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { publicDomainBindingDto, publicCatalogDto } from '@/shared/contracts/teacher-websites';
import { websiteDomainHostname, isReservedWebsiteHostname } from '@/shared/contracts/website-domains';
import { publicPlatformOrigin, publicWebsitePath, visitorQuery, validatePublicPage } from '@/shared/public-website';
import type { VisitorQuery } from '@/shared/public-website';
import { anonymousCatalogClient } from '@/server/integrations/public-catalog';
import type { PublicTeacherCatalog } from '@/shared/contracts/teacher-websites';
const failure=(message:string,status:number)=>Object.assign(new Error(message),{status});
export const customDomainIngressStatus=()=>({enabled:false as const,reason:'No approved signed proxy, durable nonce/budget services or HTTPS ingress is configured.'});
export type DomainRoutingPorts={
 lookup:(hostname:string)=>Promise<unknown>;
 catalog:(slug:string,query:VisitorQuery,courseId?:string)=>Promise<PublicTeacherCatalog>;
 consumeNonce:(nonce:string,expiresAt:number)=>Promise<boolean>;
 consumeBudget:(hostname:string)=>Promise<boolean>;
 consumeSiteBudget:(slug:string)=>Promise<boolean>;
};
export async function anonymousDomainLookup(hostname:string){
 const {data,error}=await anonymousCatalogClient().rpc('resolve_teacher_website',{p_hostname:hostname});
 if(error)throw failure('Domain lookup is temporarily unavailable.',503);return data;
}
type Settings={enabled:boolean;platformOrigin:string;proxyAuthority:string;proxySecret:string;reservedHosts:readonly string[];now?:()=>number};
/** Used by a future isolated ingress, not by the private LMS middleware or a public verification endpoint. */
export async function resolveCustomDomainRequest(request:Request,settings:Settings,ports:DomainRoutingPorts){
 if(!settings.enabled)throw failure(customDomainIngressStatus().reason,503);
 const origin=publicPlatformOrigin(settings.platformOrigin),now=(settings.now??Date.now)(),url=new URL(request.url);
 if(settings.proxySecret.length<32||!settings.proxyAuthority||request.headers.get('host')!==settings.proxyAuthority||!['GET','HEAD'].includes(request.method))throw failure('Untrusted domain ingress.',403);
 const authority=request.headers.get('x-edulabs-authority')??'',issued=request.headers.get('x-edulabs-issued-at')??'',nonce=request.headers.get('x-edulabs-nonce')??'',signature=request.headers.get('x-edulabs-signature')??'';
 let host:string;try{host=websiteDomainHostname.parse(authority);}catch{throw failure('Invalid public hostname.',421);}
 if(host!==authority||isReservedWebsiteHostname(host,[new URL(origin).hostname,...settings.reservedHosts]))throw failure('Reserved or noncanonical public hostname.',421);
 if(!/^\d{13}$/.test(issued)||Number(issued)>now+5000||now-Number(issued)>30000||!/^[a-f0-9]{32}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))throw failure('Invalid or expired proxy proof.',403);
 const target=url.pathname+url.search;if(target.length>1024)throw failure('Invalid public route.',400);
 const payload=['edulabs-domain-v1',host,request.method,target,issued,nonce].join('\n');
 const expected=createHmac('sha256',settings.proxySecret).update(payload).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw failure('Invalid proxy signature.',403);
 let courseId:string|undefined;if(url.pathname!=='/'){
  const m=/^\/courses\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(url.pathname);if(!m)throw failure('Private and unknown routes are not available through teacher domains.',404);courseId=m[1];
 }
 if(Array.from(url.searchParams.keys()).some(k=>url.searchParams.getAll(k).length!==1)||url.pathname!=='/'&&url.search)throw failure('Invalid public query.',400);
 const query=visitorQuery.safeParse(Object.fromEntries(url.searchParams));if(!query.success)throw failure('Invalid public query.',400);
 // Both ports must be durable/atomic and available across all ingress instances. No in-process production fallback.
 let unique:boolean,budget:boolean;try{unique=await ports.consumeNonce(nonce,Number(issued)+30000);budget=unique?await ports.consumeBudget(host):false;}catch{throw failure('Durable ingress controls are unavailable.',503);}
 if(!unique)throw failure('Proxy proof was replayed or could not be recorded.',403);
 if(!budget)throw failure('Domain request budget exceeded.',429);
 async function lookup(){let raw:unknown;try{raw=await ports.lookup(host);}catch{throw failure('Domain lookup is temporarily unavailable.',503);}if(raw===null)throw failure('Public domain not found.',404);const value=publicDomainBindingDto.safeParse(raw);if(!value.success)throw failure('Invalid public domain mapping.',503);return value.data;}
 const binding=await lookup();
 if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(binding.slug)||binding.slug.length<3||binding.slug.length>80)throw failure('Invalid public domain mapping.',503);
 let allowed:boolean;try{allowed=await ports.consumeSiteBudget(binding.slug);}catch{throw failure('Durable catalog controls are unavailable.',503);}
 if(!allowed)throw failure('Website request budget exceeded.',429);
 let catalog:PublicTeacherCatalog;
 try{catalog=publicCatalogDto.parse(await ports.catalog(binding.slug,query.data,courseId));validatePublicPage(catalog,binding.slug,Number(query.data.limit),query.data.after,query.data.stage,courseId);}catch(e){const status=(e as {status?:number}).status;throw failure('Public catalog is unavailable or changed.',status===404?404:status===409?409:503);}
 const current=await lookup();
 if(current.slug!==binding.slug||current.version!==binding.version||catalog.slug!==binding.slug||catalog.version!==binding.version)throw failure('Domain publication changed. Retry the request.',409);
 return {hostname:host,slug:binding.slug,catalog,platformCanonical:new URL(publicWebsitePath(binding.slug,courseId),origin).href,platformPath:publicWebsitePath(binding.slug,courseId)};
}

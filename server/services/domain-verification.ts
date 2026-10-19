import 'server-only';
import { Resolver } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { websiteDomainHostname, isReservedWebsiteHostname } from '@/shared/contracts/website-domains';
import type { WebsiteDomain } from '@/shared/contracts/website-domains';
const failure=(message:string,status=400)=>Object.assign(new Error(message),{status});
export const domainVerificationStatus=()=>({enabled:false as const,reason:'Trusted operator credentials, audit integration and deployment approval are not configured.'});
export type TrustedDomainPort={
 load:(id:string)=>Promise<WebsiteDomain&{organization_active:boolean}>;
 review:(receipt:{id:string;revision:number;approve:true;evidence:string;data:{challenge:string;certificateReady:false}})=>Promise<void>;
};
/** Caller supplies a separately provisioned operator-only client; this does not instantiate or read credentials. */
export function createTrustedDomainReviewPort(client:{rpc:(name:'review_website_resource',args:{p_kind:'domain';p_id:string;p_revision:number;p_approve:boolean;p_evidence:string;p_data:{challenge:string;certificateReady:false}})=>PromiseLike<{error:{code?:string}|null}>},load:TrustedDomainPort['load']):TrustedDomainPort{
 return {load,review:async receipt=>{const {error}=await client.rpc('review_website_resource',{p_kind:'domain',p_id:receipt.id,p_revision:receipt.revision,p_approve:receipt.approve,p_evidence:receipt.evidence,p_data:receipt.data});if(error)throw failure(error.code==='PT409'?'Domain changed; a fresh operator review is required.':'Trusted domain review was rejected.',error.code==='PT409'?409:403);}};
}
type TxtResolver={resolveTxt:(name:string)=>Promise<string[][]>;cancel:()=>void};
/** Operator-only engine. No browser endpoint/client or configured service-role credential is created here. */
export async function verifyDomainOwnership(input:{id:string;organizationId:string;websiteId:string;revision:number;operatorTicket:string},port:TrustedDomainPort,options:{reservedHosts:readonly string[];now?:()=>number;resolver?:()=>TxtResolver;timeoutMs?:number}){
 const uuid=z.string().uuid(),command=z.object({id:uuid,organizationId:uuid,websiteId:uuid,revision:z.number().int().nonnegative(),operatorTicket:uuid}).strict().parse(input);
 const now=options.now??Date.now;
 function valid(d:WebsiteDomain&{organization_active:boolean}){
  const host=websiteDomainHostname.parse(d.hostname);
  if(isReservedWebsiteHostname(host,options.reservedHosts)||host!==d.hostname)throw failure('Reserved or noncanonical domain.');
  if(d.id!==command.id||d.organization_id!==command.organizationId||d.website_id!==command.websiteId||d.revision!==command.revision)throw failure('Domain changed or belongs to a different scope.',409);
  if(!d.organization_active||!['pending','verified','active'].includes(d.state)||!d.challenge||!/^[a-f0-9]{64}$/.test(d.challenge)||!(Date.parse(d.challenge_expires_at)>now()))throw failure('Current unexpired ownership proof is required.',403);
  return host;
 }
 const initial=await port.load(command.id),host=valid(initial),resolver=options.resolver?.()??new Resolver({timeout:2000,tries:1});
 const timeoutMs=options.timeoutMs??3000;if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>3000)throw failure('Invalid DNS time budget.');
 let timer:ReturnType<typeof setTimeout>|undefined,answers:string[][];
 try{answers=await Promise.race([resolver.resolveTxt('_edulabs-verification.'+host),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{resolver.cancel();reject(failure('DNS timed out. Retry after checking the record.',503));},timeoutMs);})]);}
 catch(e){if((e as {status?:number}).status)throw e;const code=(e as {code?:string}).code;throw failure(['ENODATA','ENOTFOUND'].includes(code??'')?'The current DNS TXT record was not found.':'DNS is temporarily unavailable. Retry later.',['ENODATA','ENOTFOUND'].includes(code??'')?400:503);}
 finally{if(timer)clearTimeout(timer);resolver.cancel();}
 if(!Array.isArray(answers)||!answers.length||answers.length>8)throw failure('DNS response is missing or exceeds its bound.');
 let bytes=0;const records:string[]=[];
 for(const chunks of answers){if(!Array.isArray(chunks)||!chunks.length||chunks.length>8||chunks.some(c=>typeof c!=='string'))throw failure('Invalid DNS TXT response.');const text=chunks.join('');bytes+=Buffer.byteLength(text);if(bytes>1024)throw failure('DNS response exceeds its bound.');records.push(text);}
 if(new Set(records).size!==1||records[0]!==initial.challenge)throw failure('Conflicting or incorrect TXT proof. Keep only the exact current challenge.');
 const current=await port.load(command.id);valid(current);
 if(current.challenge!==initial.challenge||current.hostname!==initial.hostname)throw failure('Ownership proof changed while DNS was checked.',409);
 // RPC's domain revision/expiry checks under locks are the final authority if rotation wins after this re-read.
 // A DNS success can NEVER assert HTTPS readiness; that requires a separate trusted operator certificate decision.
 await port.review({id:current.id,revision:current.revision,approve:true,evidence:'dns-txt:'+command.operatorTicket+':'+createHash('sha256').update(records[0]).digest('hex').slice(0,16),data:{challenge:current.challenge!,certificateReady:false}});
 return {state:'verified' as const,certificateReady:false as const,operatorTicket:command.operatorTicket};
}
/** Default integration is intentionally disabled before any DNS or review side effect. */
export async function requestConfiguredDomainVerification():Promise<never>{throw failure(domainVerificationStatus().reason,503);}

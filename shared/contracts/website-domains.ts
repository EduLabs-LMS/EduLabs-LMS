import { z } from 'zod';
import { normalizeWebsiteHostname } from './teacher-websites';
export const reservedWebsiteSuffixes=['edulabs.com','edulabs.app','edulabs-lms.com','vercel.app','supabase.co','firebaseapp.com','googleapis.com','cloudflare.com'] as const;
export const websiteDomainHostname=z.string().max(253).transform((v,ctx)=>{try{const host=normalizeWebsiteHostname(v);if(/(^|\.)(arpa|home|lan|corp|intranet|alt)$/.test(host)||('_edulabs-verification.'+host).length>253)throw Error();return host;}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'Use an ASCII domain without a URL, port, credentials or internationalized labels.'});return z.NEVER;}}).pipe(z.string().refine(host=>!isReservedWebsiteHostname(host),'This hostname is reserved for the platform or a provider.'));
export function isReservedWebsiteHostname(host:string,extra:readonly string[]=[]){return [...reservedWebsiteSuffixes,...extra].some(suffix=>host===suffix||host.endsWith('.'+suffix));}
export type WebsiteDomain={id:string;organization_id:string;website_id:string;hostname:string;state:'pending'|'verified'|'active'|'disabled'|'revoked';challenge:string|null;challenge_expires_at:string;verified_at:string|null;valid_until:string|null;certificate_ready:boolean;revision:number;updated_at:string};
export function domainDisplayState(domain:WebsiteDomain,now:number=Date.now()):WebsiteDomain['state']|'expired'{
 if(domain.state==='disabled'||domain.state==='revoked')return domain.state;
 if(domain.state==='pending'&&!(Date.parse(domain.challenge_expires_at)>now))return 'expired';
 if(['verified','active'].includes(domain.state)&&(!domain.valid_until||!(Date.parse(domain.valid_until)>now)))return 'expired';
 return domain.state;
}
export function domainTxtRecord(domain:Pick<WebsiteDomain,'hostname'|'challenge'>){return{name:'_edulabs-verification.'+domain.hostname,type:'TXT' as const,value:domain.challenge};}

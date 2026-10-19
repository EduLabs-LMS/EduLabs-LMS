import { z } from 'zod';
const text=(max:number)=>z.string().max(max).regex(/^[^<>\u0000-\u001f\u007f]*$/);
const uuid=z.string().uuid();
export const websiteConfig=z.object({
 displayName:text(160).refine(v=>v.trim().length>0),heroTitle:text(160).refine(v=>v.trim().length>0),
 heroSubtitle:text(400),about:text(4000),locale:z.enum(['en','ar']),theme:z.enum(['green','ink','cream']),
 accent:z.enum(['green','blue','violet','amber']),ctaLabel:text(160).refine(v=>v.trim().length>0),ctaTarget:z.enum(['sign-in','sign-up','access']),
 sections:z.array(z.enum(['hero','about','programs','courses'])).min(1).max(4).refine(v=>new Set(v).size===v.length),
 logoAssetId:uuid.nullable().optional(),heroAssetId:uuid.nullable().optional(),
}).strict();
export const publicCatalogQuery=z.object({slug:z.string().min(3).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),stageId:uuid.optional(),after:uuid.optional(),limit:z.number().int().min(1).max(50).default(20),courseId:uuid.optional()}).strict().refine(v=>!(v.after&&v.courseId));
export const publicCatalogDto=z.object({slug:z.string(),version:uuid,revision:z.number().int().nonnegative(),site:websiteConfig,
 stages:z.array(z.object({id:uuid,label:z.string(),programId:uuid,programLabel:z.string(),position:z.number().int(),programPosition:z.number().int()}).strict()),
 courses:z.array(z.object({id:uuid,title:z.string(),summary:z.string(),assetId:uuid.nullable(),stageIds:z.array(uuid)}).strict()),
 hasMore:z.boolean(),next:uuid.nullable(),
}).strict();
export type PublicTeacherCatalog=z.infer<typeof publicCatalogDto>;
export const publicWebsiteAssetDto=z.object({id:uuid,mime:z.enum(['image/webp','image/png','image/jpeg']),size:z.number().int().min(1).max(2097152),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const publicDomainBindingDto=z.object({slug:z.string(),version:uuid}).strict();
/** ASCII-only in 6A. IDN needs a separately reviewed UTS46 adapter; no punycode guess. */
export function normalizeWebsiteHostname(input:string):string {
 const host=input.toLowerCase();
 if(host.length>253||!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host)||/(^|\.)xn--|(^|\.)(localhost|local|internal|invalid|test|example|onion)$/.test(host))throw new Error('Use a valid ASCII DNS hostname without a URL, port or credentials.');
 return host;
}
/** Existing safe auth destination is /access, which still requires a valid invitation. */
export function publicWebsiteCta(target:z.infer<typeof websiteConfig>['ctaTarget']):string {
 return target==='access'?'/access':`/${target}?next=%2Faccess`;
}

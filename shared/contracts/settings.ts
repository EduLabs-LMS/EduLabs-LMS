import { z } from 'zod';
// Application settings do not contain notification preferences. Those remain
// managed by the existing communications API and Notifications page.
export const settingsResponse=z.object({kind:z.literal('application'),settings:z.tuple([])}).strict();
export const legacyDashboardItems=z.array(z.enum(['in-progress','completed'])).min(1).max(2).refine(items=>new Set(items).size===items.length);
export const legacyPersonalizationWrite=z.object({dashboard:z.string().max(80)}).strict().transform((value,ctx)=>{try{return{dashboard:JSON.stringify(legacyDashboardItems.parse(JSON.parse(value.dashboard)))};}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'Select valid dashboard items.'});return z.NEVER;}});

import { z } from 'zod';
export const accountNames=z.object({firstName:z.string().trim().min(1).max(60).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'Use a single-line name'),lastName:z.string().trim().min(1).max(60).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'Use a single-line name')}).strict();
export const avatarLimit=3*1024*1024;
export const avatarTypes=['image/png','image/jpeg','image/webp'] as const;
export type AccountProfile={user_id:string;first_name:string;last_name:string;avatar_id:string|null;onboarding_completed_at:string|null;revision:number;avatarUrl?:string|null;avatarError?:string;cleanupPending?:boolean};
export function providerPhoto(value:string|null){try{if(!value)return null;const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(url.hostname==='lh3.googleusercontent.com'||url.hostname.endsWith('.googleusercontent.com'))?url.href:null;}catch{return null;}}
export function validateAvatarSelection(file:Pick<File,'type'|'size'>){if(!avatarTypes.includes(file.type as typeof avatarTypes[number])||file.size<=0||file.size>avatarLimit)throw Error('Choose a PNG, JPEG or WebP image up to 3 MB.');}

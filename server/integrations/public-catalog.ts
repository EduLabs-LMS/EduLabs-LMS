import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/shared/supabase-config';
import type { Json } from '@/shared/contracts/database.types';
type CatalogDatabase={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:{public_teacher_catalog:{Args:{p_slug:string;p_limit:number;p_after?:string;p_stage_id?:string;p_course_id?:string};Returns:Json};resolve_teacher_website:{Args:{p_hostname:string};Returns:Json}}}};
/** Intentionally anonymous even when the visitor has Firebase/Supabase cookies. No session or privileged credential. */
export function anonymousCatalogClient(){
 const {url,publishableKey}=getSupabaseConfig();
 return createClient<CatalogDatabase>(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(8000)})}});
}

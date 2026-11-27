import 'server-only';
import type { LearningTree } from '@/shared/contracts/lessons';
export type LessonBlockView={id:string;type:string;text:string;mediaUrl:string|null;downloadUrl:string|null};
/** Existing Supabase blocks remain readable; no Clerk/Prisma data is consulted. */
export async function lessonBlockViews(tree:Pick<LearningTree,'blocks'>,lessonId:string,courseId:string,media:(id:string)=>Promise<string>):Promise<LessonBlockView[]> {
 return Promise.all(tree.blocks.filter(b=>b.lesson_id===lessonId).map(async b=>{
  const content=b.content&&typeof b.content==='object'&&!Array.isArray(b.content)?b.content:{};
  const raw=content.text??content.html??content.title;
  const text=typeof raw==='string'?raw.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim():'';
  let mediaUrl:string|null=null;
  if(b.media_asset_id&&['video','image'].includes(b.block_type)){try{mediaUrl=await media(b.media_asset_id);}catch{mediaUrl=null;}}
  else if(['video','embed'].includes(b.block_type)&&typeof content.url==='string')mediaUrl=content.url;
  return {id:b.id,type:b.block_type,text,mediaUrl,downloadUrl:b.media_asset_id&&['pdf','file'].includes(b.block_type)?`/api/learning/${courseId}/blocks/${b.id}`:null};
 }));
}

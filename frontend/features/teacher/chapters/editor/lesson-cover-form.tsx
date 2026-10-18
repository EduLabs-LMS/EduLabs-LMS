'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { uploadLessonFile } from '@/frontend/lib/lesson-upload';
import type { LearningLesson } from '@/shared/contracts/lessons';

export function LessonCoverForm({courseId,lesson}:{courseId:string;lesson:LearningLesson}) {
 const router=useRouter(),[url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setUrl(null);if(lesson.cover_asset_id)void fetch(`/api/learning/${courseId}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:lesson.cover_asset_id})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'Cover unavailable');if(alive)setUrl(v.url);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false};},[courseId,lesson.cover_asset_id]);
 async function cleanup(id:string){const r=await fetch(`/api/learning/${courseId}/cleanup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});return r.ok;}
 async function save(file:File|null){setBusy(true);setError('');let uploaded:string|null=null,attached=false;
  try{
   if(file&&!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP image.');
   if(file){const asset=await uploadLessonFile(courseId,file);uploaded=asset.id;}
   const response=await fetch(`/api/learning/${courseId}/edit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_lesson_cover',id:lesson.id,parentId:null,updatedAt:lesson.updated_at,data:{cover_asset_id:uploaded}})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Cover could not be saved');attached=true;
   if(lesson.cover_asset_id&&lesson.cover_asset_id!==uploaded&&!await cleanup(lesson.cover_asset_id))setError('Cover saved. The previous asset is shared or owned by another uploader and remains protected for trusted maintenance.');
   router.refresh();
  }catch(e){let note='';if(uploaded&&!attached&&!await cleanup(uploaded))note=` Unattached asset ${uploaded} retained for trusted cleanup.`;setError((e instanceof Error?e.message:'Cover could not be saved')+note);}finally{setBusy(false);}
 }
 return <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-semibold">Lesson cover</h3><p className="text-xs text-slate-500">Independent of part thumbnails. PNG, JPEG or WebP, up to 5 MB.</p>
  {url?<Image unoptimized width={640} height={360} src={url} alt={`${lesson.title} lesson cover`} className="aspect-video w-full max-w-lg rounded-xl object-cover" onError={()=>{setUrl(null);setError('Cover preview unavailable. Refresh to renew access.');}}/>:<p className="text-xs text-slate-500">{lesson.cover_asset_id?'Loading cover preview…':'No lesson cover. Students see the standard card.'}</p>}
  <Input aria-label="Lesson cover image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void save(file);}}/>
  {lesson.cover_asset_id&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void save(null)}>Remove lesson cover</Button>}
  {busy&&<p role="status" className="text-sm">Saving lesson cover…</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 </section>;
}

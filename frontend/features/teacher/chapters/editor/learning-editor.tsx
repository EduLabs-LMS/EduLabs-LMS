'use client';
import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';
import { LessonCoverForm } from './lesson-cover-form';
import { uploadLessonFile } from '@/frontend/lib/lesson-upload';

import { useState,useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft,FileText,LayoutDashboard,ShieldCheck } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { IconBadge } from '@/frontend/components/icon-badge';
import Banner from '@/frontend/components/banner';
import TitleForm from '@/frontend/features/teacher/courses/editor/title-form';
import DescriptionForm from '@/frontend/features/teacher/courses/editor/description-form';
import { type LearningTree,type LearningEdit,type LearningSegment,lessonVideo } from '@/shared/contracts/lessons';
import { formatChapterTitle } from '@/shared/chapter-label';
import { ModuleDetailsForm } from './module-details-form';
import { HomeworkAssignments } from '@/frontend/features/courses/lesson/homework-assignments';

async function edit(courseId:string,value:LearningEdit) {
 const r=await fetch(`/api/learning/${courseId}/edit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const v=await r.json();if(!r.ok)throw new Error(v.error||'Content could not be saved');return v.id as string;
}
function useLearningEdit(courseId:string) {
 const router=useRouter();const [error,setError]=useState(''),[busy,setBusy]=useState(false),[refreshing,startTransition]=useTransition();
 async function run(value:LearningEdit){setBusy(true);setError('');try{const id=await edit(courseId,value);startTransition(()=>router.refresh());return id;}catch(e){setError(e instanceof Error?e.message:'Save failed');throw e;}finally{setBusy(false);}}
 return {run,error,busy:busy||refreshing};
}
function CreateItem({label,parent,courseId,kind}:{label:string;parent:string;courseId:string;kind:'module'|'lesson'|'segment'}) {
 const [title,setTitle]=useState('');const {run,error,busy}=useLearningEdit(courseId);
 return <form className="flex flex-wrap gap-2 pt-3" onSubmit={async e=>{e.preventDefault();try{await run({action:`create_${kind}`,id:null,parentId:parent,updatedAt:null,data:{title}});setTitle('');}catch{}}}>
  <Input aria-label={`New ${label} title`} placeholder={`New ${label} title`} required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} className="flex-1 min-w-0"/>
  <Button disabled={busy}>Add {label}</Button>{error&&<p className="w-full text-sm text-red-700" role="alert">{error}</p>}
 </form>;
}
export function LearningTreeEditor({courseId,tree}:{courseId:string;tree:LearningTree}) {
	const courseBase = useCourseManagementPath();
 const {run,error,busy}=useLearningEdit(courseId);
 function reorder(kind:'modules'|'lessons'|'segments',parent:string,items:{id:string;updated_at:string}[],index:number,direction:number){const next=[...items];[next[index],next[index+direction]]=[next[index+direction],next[index]];void run({action:`reorder_${kind}`,id:null,parentId:parent,updatedAt:null,data:{items:next}}).catch(()=>{});}
 const arrows=(kind:'modules'|'lessons'|'segments',parent:string,items:{id:string;updated_at:string}[],index:number)=><span className="inline-flex gap-1"><Button size="sm" variant="outline" aria-label="Move up" disabled={busy||index===0} onClick={()=>reorder(kind,parent,items,index,-1)}>↑</Button><Button size="sm" variant="outline" aria-label="Move down" disabled={busy||index===items.length-1} onClick={()=>reorder(kind,parent,items,index,1)}>↓</Button></span>;
 return <div className="space-y-4">{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}{!tree.modules.length&&<p className="text-sm text-slate-500">No modules yet. Add a module, then its lessons and parts.</p>}
 {tree.modules.map((m,mi)=>{const lessons=tree.lessons.filter(l=>l.module_id===m.id);return <section key={m.id+ m.updated_at} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
  <div className="flex items-center justify-between gap-2"><strong>{formatChapterTitle(m.group_type,m.chapter_number??mi+1,m.title)}</strong>{arrows('modules',courseId,tree.modules,mi)}</div>
  <ModuleDetailsForm key={m.id+m.updated_at} courseId={courseId} module={m} onSave={run} disabled={busy}/>
  {!lessons.length&&<p className="text-xs text-slate-500">No lessons in this module.</p>}
  {lessons.map((l,li)=>{const parts=tree.segments.filter(s=>s.lesson_id===l.id);return <div key={l.id+l.updated_at} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
   <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold">Lesson {li+1} · {l.status}</span>{arrows('lessons',m.id,lessons,li)}</div>
   <LessonCoverForm courseId={courseId} lesson={l}/><TitleForm initialData={l} courseId={courseId} onSave={v=>run({action:'edit_lesson',id:l.id,parentId:null,updatedAt:l.updated_at,data:{...v,description:l.description,status:l.status as 'draft'|'published'}}).then(()=>{})}/>
   <DescriptionForm initialData={l} courseId={courseId} onSave={v=>run({action:'edit_lesson',id:l.id,parentId:null,updatedAt:l.updated_at,data:{...v,title:l.title,status:l.status as 'draft'|'published'}}).then(()=>{})}/>
   <Button size="sm" disabled={busy} variant="outline" onClick={()=>void run({action:'edit_lesson',id:l.id,parentId:null,updatedAt:l.updated_at,data:{title:l.title,description:l.description,status:l.status==='published'?'draft':'published'}}).catch(()=>{})}>{l.status==='published'?'Unpublish lesson':'Publish lesson'}</Button>
   {!parts.length&&<p className="text-xs text-slate-500">No parts yet.</p>}
   {parts.map((s,si)=><div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 p-3"><Link className="text-sm font-semibold hover:text-sky-700" href={`${courseBase}/${courseId}/chapters/${s.id}`}>{si+1}. {s.title} · {s.status}</Link>{arrows('segments',l.id,parts,si)}</div>)}
   <CreateItem label="part" kind="segment" courseId={courseId} parent={l.id}/>
  </div>;})}
  <CreateItem label="lesson" kind="lesson" courseId={courseId} parent={m.id}/>
 </section>;})}
 <CreateItem label="module" kind="module" courseId={courseId} parent={courseId}/>
 </div>;
}

export function LearningPartEditor({courseId,segment,tree,thumbnailUrl}:{courseId:string;segment:LearningSegment;tree:LearningTree;thumbnailUrl?:string|null}) {
	const courseBase = useCourseManagementPath();
 const {run,error,busy}=useLearningEdit(courseId),router=useRouter();const [videoUrl,setVideoUrl]=useState(segment.video_url??''),[fileError,setFileError]=useState(''),[uploading,setUploading]=useState(false);
 const resources=tree.resources.filter(r=>r.segment_id===segment.id);
 const values={title:segment.title,description:segment.description,status:segment.status as 'draft'|'published',video_url:segment.video_url??'',video_asset_id:segment.video_asset_id,thumbnail_asset_id:segment.thumbnail_asset_id};
 const save=(patch:Partial<typeof values>)=>run({action:'edit_segment',id:segment.id,parentId:null,updatedAt:segment.updated_at,data:{...values,...patch}}).then(()=>{});
 async function upload(file:File,video:boolean,thumbnail=false) {
  setUploading(true);setFileError('');let uploadedId:string|null=null;
  try {const v=await uploadLessonFile(courseId,file);uploadedId=v.id;
   if(thumbnail)await save({thumbnail_asset_id:v.id});else if(video)await save({video_url:'',video_asset_id:v.id});else await run({action:'attach_resource',id:segment.id,parentId:null,updatedAt:segment.updated_at,data:{name:file.name,asset_id:v.id}});
   router.refresh();
  }catch(e){let cleanupNote='';if(uploadedId){const cleaned=await fetch(`/api/learning/${courseId}/cleanup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:uploadedId})});cleanupNote=cleaned.ok?' Unattached upload cleaned safely.':' Upload retained for maintenance: '+uploadedId;}setFileError((e instanceof Error?e.message:'Upload failed')+cleanupNote);}finally{setUploading(false);}
 }
 return <div className="mx-auto w-full max-w-7xl space-y-6 pt-2 pb-16">
  <Link href={`${courseBase}/${courseId}`} className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="mr-1.5 h-4 w-4"/>Back to Lesson Setup</Link>
  <Link href={`${courseBase}/${courseId}/chapters/${segment.id}?preview=1`} className="inline-flex ml-4 text-sm font-semibold text-sky-700">Preview this part</Link>
  {segment.status!=='published'&&<Banner variant="warning" label="This lesson segment is unpublished. It will not be visible in the student lesson player."/>}
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="space-y-1"><div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200"><ShieldCheck className="h-3.5 w-3.5"/>Segment Editor</div><h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">{segment.title}</h1><p className="text-xs sm:text-sm text-slate-500">{segment.status} · Video, notes and private resources</p></div><Button disabled={busy||uploading} onClick={()=>void save({status:segment.status==='published'?'draft':'published'}).catch(()=>{})}>{segment.status==='published'?'Unpublish':'Publish'}</Button></div>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
   <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6"><div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100"><IconBadge icon={LayoutDashboard}/><h2 className="text-lg font-bold text-slate-900">Customize this segment</h2></div><TitleForm initialData={segment} courseId={courseId} onSave={save}/><DescriptionForm initialData={segment} courseId={courseId} onSave={save}/></div>
   <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6"><div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100"><IconBadge icon={FileText}/><h2 className="text-lg font-bold text-slate-900">Segment content &amp; media</h2></div>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setFileError('');const parsed=lessonVideo.safeParse(videoUrl);if(!parsed.success){setFileError(parsed.error.issues[0].message);return;}try{await save({video_url:videoUrl,video_asset_id:null});}catch{}}}><label className="block text-sm font-semibold">Explanation video URL<Input aria-label="Explanation video URL" type="url" value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} placeholder="https://…"/></label><p className="text-xs text-slate-500">YouTube, Vimeo or HTTPS MP4. External providers control their own sharing.</p><Button disabled={busy||uploading}>Save video URL</Button><Button type="button" variant="outline" disabled={busy||uploading} onClick={()=>void save({video_url:'',video_asset_id:null}).catch(()=>{})}>Remove video</Button></form>
    <label className="block text-sm font-semibold">Private MP4 (up to 50 MB)<Input type="file" accept="video/mp4" disabled={busy||uploading} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f,true);}}/></label>
    {segment.video_asset_id&&<p className="text-xs text-emerald-700">Private video attached</p>}
    <label className="block text-sm font-semibold">Part thumbnail (PNG, JPEG or WebP, up to 5 MB)<Input aria-label="Part thumbnail" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||uploading} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f,false,true);}}/></label>
    {thumbnailUrl&&<Image unoptimized width={640} height={360} src={thumbnailUrl} alt={`${segment.title} thumbnail`} className="aspect-video w-full rounded-xl object-cover"/>}
    {segment.thumbnail_asset_id&&<Button variant="outline" disabled={busy||uploading} onClick={()=>void save({thumbnail_asset_id:null}).catch(()=>{})}>Remove thumbnail</Button>}
    <label className="block text-sm font-semibold">PDF notes (20 MB) or image resources (5 MB)<Input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy||uploading} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f,false);}}/></label>
    {resources.map(r=><div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><a target="_blank" rel="noreferrer" href={`/api/learning/${courseId}/resources/${r.id}`} className="truncate text-sm font-semibold">{r.name}</a><Button variant="outline" size="sm" disabled={busy||uploading} onClick={()=>void run({action:'remove_resource',id:segment.id,parentId:null,updatedAt:segment.updated_at,data:{resource_id:r.id}}).catch(()=>{})}>Detach</Button></div>)}
    {fileError&&<p role="alert" className="text-red-700 text-sm">{fileError}</p>}
   </div>
  </div>
  {tree.blocks.filter(b=>b.lesson_id===segment.lesson_id&&['text','heading','callout'].includes(b.block_type)).map(b=>{
   const content=b.content&&typeof b.content==='object'&&!Array.isArray(b.content)?b.content:{};
   const text=typeof content.text==='string'?content.text:typeof content.html==='string'?content.html:'';
   return <div key={b.id+b.updated_at} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-slate-900">Existing lesson-wide notes</h2><DescriptionForm courseId={courseId} initialData={{description:text}} onSave={v=>run({action:'edit_block',id:b.id,parentId:null,updatedAt:b.updated_at,data:{text:v.description}}).then(()=>{})}/></div>;
  })}
  <HomeworkAssignments courseId={courseId} lessonId={segment.lesson_id} segmentId={segment.id} teacher/>
 </div>;
}

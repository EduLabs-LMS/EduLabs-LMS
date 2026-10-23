'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Editor } from '@/frontend/components/editor';
type Course = {id:string;title:string;slug:string;description:string|null;status:string;visibility:string;updated_at:string};
export function TeacherForm({course,organizations=[],onboarding=false}:{course?:Course;organizations?:{id:string;name:string}[];onboarding?:boolean}) {
  const router=useRouter();
  const [title,setTitle]=useState(course?.title??'');
  const [slug,setSlug]=useState(course?.slug??'');
  const [description,setDescription]=useState(course?.description??'');
  const [organization,setOrganization]=useState(organizations[0]?.id??'');
  const [status,setStatus]=useState(course?.status??'draft');
  const [visibility,setVisibility]=useState(course?.visibility??'private');
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  async function save(event:FormEvent) {
    event.preventDefault(); setBusy(true);setError('');
    try {
      const endpoint=onboarding?'/api/teacher/organizations':course?'/api/teacher/courses/'+course.id:'/api/teacher/courses';
      const body=onboarding?{name:title,slug}:course?{title,slug,description,status,visibility,updated_at:course.updated_at}:{title,slug,organization_id:organization};
      const response=await fetch(endpoint,{method:course?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||'Unable to save');
      if(onboarding) router.push('/teacher/create');
      else if(!course) router.push('/self-learning/'+result.id);
      router.refresh();
    } catch(caught) {setError(caught instanceof Error?caught.message:'Unable to save');}
    finally {setBusy(false);}
  }
  if(!course&&!onboarding&&!organizations.length) return <div className="rounded-2xl border bg-white p-6"><p>No organization permits course creation.</p><p>Course access is arranged by EduLabs staff.</p></div>;
  return <form onSubmit={save} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    {!course&&!onboarding&&<label className="block space-y-2">Organization<select className="block w-full rounded-md border p-2" value={organization} onChange={e=>setOrganization(e.target.value)} disabled={busy}>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
    <label className="block space-y-2">{onboarding?'Organization name':'Course title'}<Input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
    <label className="block space-y-2">Slug<Input required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="physics-secondary-3" value={slug} onChange={e=>setSlug(e.target.value)} disabled={busy}/><span className="text-xs text-slate-500">Lowercase letters, numbers and hyphens. Must be unique within the organization.</span></label>
    {course&&<><div className="space-y-2"><label>Course description</label><Editor value={description} onChange={setDescription}/></div><div className="flex flex-wrap gap-6">
      <label>Status<select aria-label="Course status" disabled={busy} className="ml-3 rounded-md border p-2" value={status} onChange={e=>setStatus(e.target.value)}>{['draft','published','archived'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Visibility<select aria-label="Course visibility" disabled={busy} className="ml-3 rounded-md border p-2" value={visibility} onChange={e=>setVisibility(e.target.value)}>{['private','unlisted','public'].map(s=><option key={s}>{s}</option>)}</select></label>
    </div><p className="text-sm text-slate-500">Publishing course metadata does not publish draft lessons or enroll students. Student content access still requires an authorized offering.</p></>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <Button disabled={busy}>{busy?'Saving…':onboarding?'Create organization':course?'Save changes':'Create draft course'}</Button>
  </form>;
}

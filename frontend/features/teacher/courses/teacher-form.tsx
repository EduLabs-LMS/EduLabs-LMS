'use client';
import { T } from '@/frontend/design/preferences';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/frontend/components/ui/button';
import { useLocale } from '@/frontend/design/preferences';
import { Input } from '@/frontend/components/ui/input';
import { Editor } from '@/frontend/components/editor';
type Course = {id:string;title:string;slug:string;description:string|null;status:string;visibility:string;updated_at:string};
export function TeacherForm({course,organizations=[],onboarding=false}:{course?:Course;organizations?:{id:string;name:string}[];onboarding?:boolean}) {
  const router=useRouter();
  const {t}=useLocale();
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
      if(!response.ok) throw new Error(result.error||t('Unable to save'));
      if(onboarding) router.push('/teacher/create');
      else if(!course) router.push('/teacher/courses/'+result.id);
      router.refresh();
    } catch(caught) {setError(caught instanceof Error?caught.message:t('Unable to save'));}
    finally {setBusy(false);}
  }
  if(!course&&!onboarding&&!organizations.length) return <div className="rounded-2xl border bg-white p-6"><p><T>{"No organization permits course creation."}</T></p><Link className="text-sky-700 underline" href="/onboarding/organization"><T>{"Create your organization"}</T></Link></div>;
  return <form onSubmit={save} className="edu-card edu-teacher-form">
    {!course&&!onboarding&&<label className="block space-y-2"><T>{"Organization"}</T><select className="block w-full rounded-md border p-2" value={organization} onChange={e=>setOrganization(e.target.value)} disabled={busy}>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
    <label className="block space-y-2">{onboarding?t('Organization name'):t('Course title')}<Input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
    <label className="block space-y-2"><T>{"Slug"}</T><Input required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="physics-secondary-3" dir="ltr" value={slug} onChange={e=>setSlug(e.target.value)} disabled={busy}/><span className="text-xs text-slate-500"><T>{"Lowercase letters, numbers and hyphens. Must be unique within the organization."}</T></span></label>
    {course&&<><div className="space-y-2"><label><T>{"Course description"}</T></label><Editor value={description} onChange={setDescription}/></div><div className="flex flex-wrap gap-6">
      <label><T>{"Status"}</T><select aria-label={t('Course status')} disabled={busy} className="ms-3 rounded-md border p-2" value={status} onChange={e=>setStatus(e.target.value)}>{['draft','published','archived'].map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
      <label><T>{"Visibility"}</T><select aria-label={t('Course visibility')} disabled={busy} className="ms-3 rounded-md border p-2" value={visibility} onChange={e=>setVisibility(e.target.value)}>{['private','unlisted','public'].map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
    </div><p className="text-sm text-slate-500"><T>{"Publishing course metadata does not publish draft lessons or enroll students. Student content access still requires an authorized offering."}</T></p></>}
    {error&&<p role="alert" className="text-red-700">{t(error)}</p>}
    <Button disabled={busy}>{busy?t('Saving…'):onboarding?t('Create organization'):course?t('Save changes'):t('Create draft course')}</Button>
  </form>;
}

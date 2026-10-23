'use client';
import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useState } from 'react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { Editor } from '@/frontend/components/editor';
import { CHAPTER_TYPE_PRESETS,formatChapterTitle,parseChapterInfo } from '@/shared/chapter-label';
import type { LearningModule,LearningEdit } from '@/shared/contracts/lessons';

export function ModuleDetailsForm({courseId,module:m,onSave,disabled=false}:{courseId:string;module:LearningModule;onSave:(value:LearningEdit)=>Promise<unknown>;disabled?:boolean}) {
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [choice,setChoice]=useState((CHAPTER_TYPE_PRESETS as readonly string[]).includes(m.group_type)?m.group_type:'__custom__');
 const [custom,setCustom]=useState(m.group_type),[number,setNumber]=useState(String(m.chapter_number??1)),[name,setName]=useState(m.title),[summary,setSummary]=useState(m.summary??''),[description,setDescription]=useState(m.description??'');
 const type=choice==='__custom__'?custom:choice;
 function reset(){setChoice((CHAPTER_TYPE_PRESETS as readonly string[]).includes(m.group_type)?m.group_type:'__custom__');setCustom(m.group_type);setNumber(String(m.chapter_number??1));setName(m.title);setSummary(m.summary??'');setDescription(m.description??'');setError('');}
 async function submit(){const parsed=parseChapterInfo({type,number:Number(number),name,summary,description});if(!parsed.ok){setError(parsed.error);return;}setSaving(true);setError('');try{const v=parsed.value;await onSave({action:'edit_module_details',id:m.id,parentId:courseId,updatedAt:m.updated_at,data:{title:v.name,group_type:v.type,chapter_number:v.number,summary:v.summary,description:v.description??''}});setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Chapter could not be saved');}finally{setSaving(false);}}
 if(!open)return <Button type="button" variant="outline" disabled={disabled} onClick={()=>{reset();setOpen(true);}}>Edit chapter details</Button>;
 return <form className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Chapter details" onSubmit={e=>{e.preventDefault();void submit();}}>
  <label className="block text-sm font-semibold">Type<Dropdown aria-label="Chapter type" className="ml-3 rounded-md border bg-white p-2" value={choice} disabled={saving} onChange={e=>setChoice(e.target.value)}>{CHAPTER_TYPE_PRESETS.map(t=><option key={t}>{t}</option>)}<option value="__custom__">Custom</option></Dropdown></label>
  {choice==='__custom__'&&<label className="block text-sm">Custom type<Input aria-label="Custom chapter type" maxLength={24} required disabled={saving} value={custom} onChange={e=>setCustom(e.target.value)}/></label>}
  <label className="block text-sm">Number<Input aria-label="Chapter number" type="number" min={1} max={99} step={1} required disabled={saving} value={number} onChange={e=>setNumber(e.target.value)}/></label>
  <label className="block text-sm">Name<Input aria-label="Chapter name" required maxLength={120} disabled={saving} value={name} onChange={e=>setName(e.target.value)}/></label>
  <label className="block text-sm">Short summary<Textarea aria-label="Chapter summary" maxLength={200} disabled={saving} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
  <div className="space-y-2"><p className="text-sm">Full description (optional, up to 2,000 characters including formatting)</p><fieldset disabled={saving}><Editor value={description} onChange={setDescription}/></fieldset></div>
  <p className="text-sm text-slate-600" aria-live="polite">Preview: {formatChapterTitle(type,Number(number)||null,name)}</p>
  {m.chapter_number==null&&<p className="text-xs text-slate-500">Choose the number to preserve for this existing chapter. Reordering will not change your saved number.</p>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{saving&&<p role="status">Saving chapter…</p>}
  <div className="flex gap-3"><Button disabled={saving||disabled}>Save chapter</Button><Button type="button" variant="outline" disabled={saving} onClick={()=>{reset();setOpen(false);}}>Cancel</Button></div>
 </form>;
}

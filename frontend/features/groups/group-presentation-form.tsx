'use client';
import { useEffect, useState } from 'react';
import { groupEdit, groupStreamIcons } from '@/shared/contracts/groups';
import type { StudyGroup } from '@/shared/contracts/groups';
import { StreamBubble } from './stream-bubble';

const field='mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900';
const button='rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-50';
export function GroupPresentationForm({group,disabled,onSave}:{group:StudyGroup;disabled:boolean;onSave:(patch:object)=>Promise<void>}) {
 const [mode,setMode]=useState(group.mode),[location,setLocation]=useState(group.location),[url,setUrl]=useState(group.join_url),[label,setLabel]=useState(group.stream_label??'Live interactive stream'),[icon,setIcon]=useState<typeof groupStreamIcons[number]>(group.stream_icon??'video'),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{setMode(group.mode);setLocation(group.location);setUrl(group.join_url);setLabel(group.stream_label??'Live interactive stream');setIcon(group.stream_icon??'video');},[group]);
 return <form className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-busy={saving} onSubmit={async e=>{e.preventDefault();setError('');setSaved(false);try{if(mode==='center'&&!location.trim())throw Error('Enter a center location');const patch=groupEdit.parse({mode,location,joinUrl:url,streamLabel:label,streamIcon:icon,applyMeetingDefaults:true});setSaving(true);await onSave(patch);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Unable to save group presentation');}finally{setSaving(false);}}}>
  <h2 className="text-xl font-bold">Class card &amp; meeting link</h2>
  <fieldset disabled={disabled||saving} className="space-y-4">
   <label className="block text-sm">Class mode<select aria-label="Class mode" className={field} value={mode} onChange={e=>{setSaved(false);setMode(e.target.value as 'online'|'center');}}><option value="online">Online</option><option value="center">Center / In-Person</option></select></label>
   <label className="block text-sm">Class location<input className={field} maxLength={1000} value={location} onChange={e=>{setSaved(false);setLocation(e.target.value);}} required={mode==='center'}/></label>
   <label className="block text-sm">Meeting URL (HTTPS)<input className={field} maxLength={2000} value={url} onChange={e=>{setSaved(false);setUrl(e.target.value);}} placeholder="https://meet.jit.si/your-room"/></label>
   <div className="flex flex-wrap items-center gap-4 text-sm"><a href="https://meet.jit.si/" target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-700 underline">Open Jitsi</a><button type="button" className={button} onClick={()=>{setUrl('');setSaved(false);}}>Clear meeting link</button>{group.join_url&&<a className="break-all text-cyan-700 underline" href={group.join_url} target="_blank" rel="noopener noreferrer">Saved meeting link</a>}</div>
   <p className="text-xs text-slate-500">Saving updates future automatic sessions; one-off exceptions and started sessions retain their dated details. External meeting access is controlled by the meeting provider. Saving a link does not make a meeting private.</p>
   <label className="block text-sm">Stream bubble text<input required maxLength={80} className={field} value={label} onChange={e=>{setSaved(false);setLabel(e.target.value);}}/></label>
   <label className="block text-sm">Stream bubble icon<select aria-label="Stream bubble icon" className={field} value={icon} onChange={e=>{setSaved(false);setIcon(e.target.value as typeof icon);}}>{groupStreamIcons.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
   <div aria-label="Stream bubble preview" className="w-fit rounded-full bg-slate-950 px-4 py-2 text-sm text-white"><StreamBubble label={label} icon={icon}/></div>
   <button className={button}>{saving?'Saving…':'Save class card'}</button>
  </fieldset>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{saved&&<p role="status" className="text-sm text-emerald-700">Class card saved.</p>}
 </form>;
}

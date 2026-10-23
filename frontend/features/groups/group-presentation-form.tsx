'use client';
import { useEffect, useState } from 'react';
import { groupEdit, groupStreamIcons } from '@/shared/contracts/groups';
import type { StudyGroup } from '@/shared/contracts/groups';
import { StreamBubble } from './stream-bubble';
import { L } from '@/frontend/components/language-provider';
import { makeJitsiRoom } from '@/shared/group-meeting';

const field='mt-1 min-h-[44px] w-full rounded-xl border-2 border-black bg-white p-3 text-sm text-slate-900';
const button='min-h-[44px] rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold shadow-hard-sm hover:bg-slate-100 disabled:opacity-50';
export function GroupPresentationForm({group,disabled,onSave}:{group:StudyGroup;disabled:boolean;onSave:(patch:object)=>Promise<void>}) {
 const [mode,setMode]=useState(group.mode),[location,setLocation]=useState(group.location),[url,setUrl]=useState(group.join_url),[label,setLabel]=useState(group.stream_label??'Live interactive stream'),[icon,setIcon]=useState<typeof groupStreamIcons[number]>(group.stream_icon??'video'),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[made,setMade]=useState(false),[copied,setCopied]=useState(false);
 useEffect(()=>{setMode(group.mode);setLocation(group.location);setUrl(group.join_url);setLabel(group.stream_label??'Live interactive stream');setIcon(group.stream_icon??'video');},[group]);
 return <form className="space-y-4 rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6" aria-busy={saving} onSubmit={async e=>{e.preventDefault();setError('');setSaved(false);try{if(mode==='center'&&!location.trim())throw Error('Enter a center location');const patch=groupEdit.parse({mode,location,joinUrl:url,streamLabel:label,streamIcon:icon,applyMeetingDefaults:true});setSaving(true);await onSave(patch);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Unable to save group presentation');}finally{setSaving(false);}}}>
  <h2 className="text-xl font-bold">Class card &amp; meeting link</h2>
  <fieldset disabled={disabled||saving} className="space-y-4">
   <label className="block text-sm">Class mode<select aria-label="Class mode" className={field} value={mode} onChange={e=>{setSaved(false);setMode(e.target.value as 'online'|'center');}}><option value="online">Online</option><option value="center">Center / In-Person</option></select></label>
   <label className="block text-sm">Class location<input className={field} maxLength={1000} value={location} onChange={e=>{setSaved(false);setLocation(e.target.value);}} required={mode==='center'}/></label>
   <label className="block text-sm">Meeting URL (HTTPS)<input className={field} maxLength={2000} value={url} onChange={e=>{setSaved(false);setUrl(e.target.value);}} placeholder="https://meet.jit.si/your-room"/></label>
   <div className="flex flex-wrap items-center gap-3 text-sm"><button type="button" className={button+' !bg-primary'} onClick={()=>{try{setUrl(makeJitsiRoom());setMade(true);setSaved(false);setCopied(false);}catch(e){setError(e instanceof Error?e.message:'Could not create a room');}}}><L id="groups.create_room"/></button><a href="https://meet.jit.si/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center font-semibold underline">Open Jitsi</a><button type="button" className={button} disabled={!url} onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setError('Copy is not available here. Select the link and copy it.');}}}><L id="groups.copy_link"/></button><button type="button" className={button} onClick={()=>{setUrl('');setMade(false);setSaved(false);}}>Clear meeting link</button>{group.join_url&&<a className="break-all underline" href={group.join_url} target="_blank" rel="noopener noreferrer">Saved meeting link</a>}</div>
   {made&&<p role="status" className="rounded-2xl border-2 border-dashed border-black p-3 text-sm"><L id="groups.room_note"/></p>}{copied&&<p role="status" className="text-sm"><L id="groups.link_copied"/></p>}
   <p className="text-xs text-slate-500">Saving updates future automatic sessions; one-off exceptions and started sessions retain their dated details. External meeting access is controlled by the meeting provider. Saving a link does not make a meeting private.</p>
   <label className="block text-sm">Stream bubble text<input required maxLength={80} className={field} value={label} onChange={e=>{setSaved(false);setLabel(e.target.value);}}/></label>
   <label className="block text-sm">Stream bubble icon<select aria-label="Stream bubble icon" className={field} value={icon} onChange={e=>{setSaved(false);setIcon(e.target.value as typeof icon);}}>{groupStreamIcons.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
   <div aria-label="Stream bubble preview" className="w-fit rounded-full border-2 border-black bg-slate-950 px-4 py-2 text-sm text-white"><StreamBubble label={label} icon={icon}/></div>
   <button className={button}>{saving?'Saving…':'Save class card'}</button>
  </fieldset>
  {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{saved&&<p role="status" className="text-sm text-green-900">Class card saved.</p>}
 </form>;
}

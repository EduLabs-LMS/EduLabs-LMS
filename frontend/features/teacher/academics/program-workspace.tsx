'use client';
import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { academicRequest } from '@/frontend/lib/academics';
import { academicWrite } from '@/shared/contracts/academics';
import type { AcademicOrganization, AcademicProgram, AcademicStage, AcademicPage, AcademicWrite } from '@/shared/contracts/academics';

export const academicPanel='rounded-3xl border-2 border-black bg-card p-5 shadow-hard-sm sm:p-6';
export const academicButton='rounded-xl border-2 border-black bg-primary px-4 py-2 text-sm font-bold shadow-hard-sm disabled:opacity-50';
const field='mt-1 w-full min-w-0 rounded-xl border-2 border-black bg-background p-3 text-sm';

export function useAcademicPage<T>(query:Record<string,string>) {
 const key=JSON.stringify(query),[version,setVersion]=useState(0),[data,setData]=useState<AcademicPage<T>|null>(null),[error,setError]=useState(''),[loadedKey,setLoadedKey]=useState('');
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');setLoadedKey(key);if(!JSON.parse(key).organizationId)return()=>controller.abort();
  void academicRequest<AcademicPage<T>>(JSON.parse(key),undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Unable to load academic data.');});
  return()=>controller.abort();
 },[key,version]);
 return {data:loadedKey===key?data:null,error:loadedKey===key?error:'',reload:()=>setVersion(v=>v+1)};
}
export function PageControls({page,hasMore,onPage,disabled}:{page:number;hasMore:boolean;onPage:(page:number)=>void;disabled?:boolean}) {
 return <nav aria-label="Academic pages" className="flex items-center gap-4 text-sm"><button disabled={!page||disabled} onClick={()=>onPage(page-1)} className="underline disabled:opacity-40">Previous page</button><span>Page {page+1}</span><button disabled={!hasMore||disabled} onClick={()=>onPage(page+1)} className="underline disabled:opacity-40">Next page</button></nav>;
}
export function AcademicLoadState({error,retry}:{error:string;retry:()=>void}) {
 return error?<div role="alert" className="space-y-2 text-sm text-red-800"><p>{error}</p><button className="underline" onClick={retry}>Retry loading</button></div>:<p role="status" className="text-sm">Loading academic data…</p>;
}
type Item=AcademicProgram|AcademicStage;
const STANDARD_STAGES=[{label:'1st Secondary',slug:'1st-secondary'},{label:'2nd Secondary',slug:'2nd-secondary'},{label:'3rd Secondary',slug:'3rd-secondary'}];
export function AcademicWorkspace({organizations}:{organizations:AcademicOrganization[]}) {
 const [organizationId,setOrganization]=useState(organizations[0]?.id??''),[page,setPage]=useState(0),[selected,setSelected]=useState<AcademicProgram|null>(null),[editing,setEditing]=useState<AcademicProgram|'new'|null>(null),[busy,setBusy]=useState(false);
 const operation=useRef(false),programs=useAcademicPage<AcademicProgram>({kind:'programs',organizationId,page:String(page)});
 async function commit(input:AcademicWrite){if(operation.current)throw Error('Wait for the current save.');operation.current=true;setBusy(true);try{return await academicRequest({},input);}finally{operation.current=false;setBusy(false);}}
 if(!organizations.length)return <section className={academicPanel}><h1 className="font-display text-2xl">Academic programs</h1><p className="mt-3">No active teaching organization is available for this account.</p></section>;
 return <div className="mx-auto max-w-7xl space-y-6 pb-16">
  <header className="space-y-3"><Link href="/self-learning" className="text-sm underline">Back to courses</Link><h1 className="font-display text-3xl">Academic programs &amp; stages</h1><p className="text-sm">Organize multiple curricula in your existing teacher dashboard. Classification never enrolls a student or publishes a course.</p>
   <label className="block max-w-md text-sm font-bold">Teaching organization<Dropdown className={field} disabled={busy} value={organizationId} onChange={e=>{setOrganization(e.target.value);setPage(0);setSelected(null);setEditing(null);}}>{organizations.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</Dropdown></label>
  </header>
  <div className="grid items-start gap-6 lg:grid-cols-2">
   <section className={academicPanel}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl">Programs</h2>{programs.data?.canManage&&<button className={academicButton} disabled={busy} onClick={()=>setEditing('new')}>New program</button>}</div>
    {!programs.data?<AcademicLoadState error={programs.error} retry={programs.reload}/>:<>
     {!programs.data.canManage&&<p className="mb-4 text-sm">You can view this organization&apos;s programs. An owner or admin manages the taxonomy.</p>}
     {!programs.data.items.length&&<p className="text-sm">No programs on this page. Existing courses remain Unassigned.</p>}
     <ul className="space-y-3">{programs.data.items.map(p=><li key={p.id} className="rounded-2xl border-2 border-black bg-background p-4"><button disabled={busy} className="break-words text-start font-bold underline" onClick={()=>{setSelected(p);setEditing(null);}}>{p.label}</button><p className="mt-1 text-xs">Order {p.position} · {p.status}</p>{p.description&&<p className="mt-2 whitespace-pre-wrap break-words text-sm">{p.description}</p>}
      {programs.data!.canManage&&<div className="mt-3 flex flex-wrap gap-3"><button className="text-sm underline" disabled={busy} onClick={()=>setEditing(p)}>Edit program</button><ArchiveControl item={p} kind="program" organizationId={organizationId} disabled={busy} commit={commit} onSaved={()=>{programs.reload();setSelected(null);setEditing(null);}}/></div>}
     </li>)}</ul><div className="mt-4"><PageControls page={page} hasMore={programs.data.hasMore} onPage={value=>{setPage(value);setSelected(null);setEditing(null);}} disabled={busy}/></div>
    </>}
    {editing&&<AcademicForm key={editing==='new'?'new':editing.id+editing.revision} kind="program" initial={editing==='new'?undefined:editing} organizationId={organizationId} disabled={busy} commit={commit} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setSelected(null);programs.reload();}} onReload={()=>{setEditing(null);setSelected(null);programs.reload();}}/>}
   </section>
   {selected?<Stages key={organizationId+selected.id+selected.revision} program={selected} organizationId={organizationId} disabled={busy} commit={commit}/>:<section className={academicPanel}><h2 className="font-display text-xl">Stages</h2><p className="mt-3 text-sm">Select a program to view and manage its stages.</p></section>}
  </div>
 </div>;
}
function Stages({program,organizationId,disabled,commit}:{program:AcademicProgram;organizationId:string;disabled:boolean;commit:(input:AcademicWrite)=>Promise<unknown>}) {
 const [page,setPage]=useState(0),[editing,setEditing]=useState<AcademicStage|'new'|null>(null),stages=useAcademicPage<AcademicStage>({kind:'stages',organizationId,programId:program.id,page:String(page)});
 const [seedError,setSeedError]=useState(''),[seedDone,setSeedDone]=useState('');
 const have=new Set((stages.data?.items??[]).map(s=>s.slug)),missing=STANDARD_STAGES.filter(x=>!have.has(x.slug));
 async function addStandard(){
  setSeedError('');setSeedDone('');let added=0;
  try{
   const base=Math.max(0,...(stages.data?.items??[]).map(s=>s.position));
   for(let i=0;i<missing.length;i++){const stage=missing[i];
    try{await commit(academicWrite.parse({action:'stage.create',organizationId,data:{label:stage.label,slug:stage.slug,description:null,position:base+i+1,status:'active',programId:program.id}}));added++;}
    catch(e){if((e as {status?:number}).status!==409&&!/already in use/i.test((e as Error).message))throw e;}
   }
   setSeedDone(added?'Added '+added+' standard '+(added===1?'stage':'stages')+'.':'The standard stages already exist.');
  }catch(e){setSeedError((e as Error).message||'Unable to add the standard stages.');}
  stages.reload();
 }
 return <section className={academicPanel}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl">Stages · {program.label}</h2>{stages.data?.canManage&&program.status==='active'&&<button className={academicButton} disabled={disabled} onClick={()=>setEditing('new')}>New stage</button>}</div>
  {stages.data?.canManage&&program.status==='active'&&<div className="mb-4 space-y-2 text-sm"><button className="underline disabled:opacity-40" disabled={disabled||!missing.length} onClick={addStandard}>Add standard stages (1st to 3rd Secondary)</button><p className="text-xs">Adds only the ones this program is missing. You can rename or archive them afterwards.</p>{seedDone&&<p role="status">{seedDone}</p>}{seedError&&<p role="alert" className="text-red-800">{seedError}</p>}</div>}
  {program.status==='archived'&&<p className="mb-4 text-sm">This program is archived. Restore it before adding or reactivating stages.</p>}
  {!stages.data?<AcademicLoadState error={stages.error} retry={stages.reload}/>:<><ul className="space-y-3">{stages.data.items.map(s=><li className="rounded-2xl border-2 border-black bg-background p-4" key={s.id}><h3 className="break-words font-bold">{s.label}</h3><p className="mt-1 text-xs">Order {s.position} · {s.status}</p>{s.description&&<p className="mt-2 whitespace-pre-wrap break-words text-sm">{s.description}</p>}
   {stages.data!.canManage&&<div className="mt-3 flex flex-wrap gap-3"><button disabled={disabled||(program.status==='archived'&&s.status==='active')} className="text-sm underline disabled:opacity-40" onClick={()=>setEditing(s)}>Edit stage</button><ArchiveControl item={s} kind="stage" organizationId={organizationId} disabled={disabled||(program.status==='archived'&&s.status==='archived')} commit={commit} onSaved={()=>{setEditing(null);stages.reload();}}/></div>}</li>)}</ul>
   {!stages.data.items.length&&<p className="text-sm">No stages on this page.</p>}<div className="mt-4"><PageControls page={page} hasMore={stages.data.hasMore} onPage={v=>{setPage(v);setEditing(null);}} disabled={disabled}/></div></>}
  {editing&&<AcademicForm key={editing==='new'?'new':editing.id+editing.revision} kind="stage" programId={program.id} organizationId={organizationId} initial={editing==='new'?undefined:editing} disabled={disabled} commit={commit} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);stages.reload();}} onReload={()=>{setEditing(null);stages.reload();}}/>}
 </section>;
}
function ArchiveControl({item,kind,organizationId,disabled,commit,onSaved}:{item:Item;kind:'program'|'stage';organizationId:string;disabled:boolean;commit:(input:AcademicWrite)=>Promise<unknown>;onSaved:()=>void}) {
 const [error,setError]=useState('');
 return <><button disabled={disabled} className="text-sm underline disabled:opacity-40" onClick={async()=>{setError('');try{await commit(academicWrite.parse({action:kind+'.edit',organizationId,id:item.id,revision:item.revision,data:{status:item.status==='active'?'archived':'active'}}));onSaved();}catch(e){setError((e as Error).message);}}}>{item.status==='active'?'Archive':'Restore'}</button>{error&&<p role="alert" className="w-full text-sm text-red-800">{error} <button className="underline" onClick={onSaved}>Reload latest</button></p>}</>;
}
function AcademicForm({kind,initial,programId,organizationId,disabled,commit,onSaved,onClose,onReload}:{kind:'program'|'stage';initial?:Item;programId?:string;organizationId:string;disabled:boolean;commit:(input:AcademicWrite)=>Promise<unknown>;onSaved:()=>void;onClose:()=>void;onReload:()=>void}) {
 const [label,setLabel]=useState(initial?.label??''),[slug,setSlug]=useState(initial?.slug??''),[description,setDescription]=useState(initial?.description??''),[position,setPosition]=useState(initial?.position??0),[status,setStatus]=useState(initial?.status??'active'),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 return <form aria-label={(initial?'Edit':'New')+' '+kind} className="mt-5 space-y-3 border-t-2 border-black pt-5" onSubmit={async e=>{e.preventDefault();setError('');setConflict(false);try{const data={label,slug,description:description||null,position,status,...(!initial&&kind==='stage'?{programId}:{})};const input=academicWrite.safeParse({action:kind+(initial?'.edit':'.create'),organizationId,...(initial?{id:initial.id,revision:initial.revision}:{}),data});if(!input.success)throw Error('Check the title, lowercase slug, description and whole-number order.');await commit(input.data);onSaved();}catch(e){setError((e as Error).message);setConflict((e as {status?:number}).status===409);}}}>
  <h3 className="font-bold">{initial?'Edit':'New'} {kind}</h3><fieldset disabled={disabled} className="space-y-3"><label className="block text-sm font-bold">Title<input autoFocus className={field} required maxLength={160} value={label} onChange={e=>setLabel(e.target.value)}/></label>
   <label className="block text-sm font-bold">Slug<input className={field} required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e=>setSlug(e.target.value)}/></label>
   <label className="block text-sm font-bold">Description<textarea className={field} maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
   <label className="block text-sm font-bold">Order<input className={field} type="number" required min={0} max={1000000} step={1} value={position} onChange={e=>setPosition(e.target.valueAsNumber)}/></label><p className="text-xs">Lower numbers appear first. Equal positions use a stable ID order.</p>
   <label className="block text-sm font-bold">Status<Dropdown className={field} value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option></Dropdown></label><p className="text-xs">Archiving preserves course links and student history.</p>
   <div className="flex flex-wrap gap-4"><button className={academicButton}>{disabled?'Saving…':'Save '+kind}</button><button className="text-sm underline" type="button" onClick={onClose}>Cancel</button></div>
  </fieldset>{error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{conflict&&<button type="button" onClick={onReload} className="text-sm underline">Discard draft and reload latest</button>}
 </form>;
}

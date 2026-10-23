'use client';
import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useEffect, useState } from 'react';
import type { StudentAcademics, StagePreference } from '@/shared/contracts/student-academics';
const panel='rounded-3xl border-2 border-black bg-card p-5 shadow-hard-sm sm:p-6';
const button='rounded-xl border-2 border-black bg-primary px-4 py-2 text-sm font-bold shadow-hard-sm disabled:opacity-50';
export async function studentAcademicRequest<T>(organizationId?:string,input?:{programId:string;stageId:string|null;revision:number},signal?:AbortSignal):Promise<T> {
 const response=await fetch('/api/student-academics'+(!input&&organizationId?'?'+new URLSearchParams({organizationId}):''),{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
 const value=await response.json();
 if(!response.ok)throw Object.assign(new Error(value.error||'Academic choices unavailable. Please retry.'),{status:response.status});
 return value;
}
function ProgramChoice({id,label,stages,preference,reload,onSaved}:{id:string;label:string;stages:StudentAcademics['stages'];preference?:StagePreference;reload:()=>void;onSaved:()=>void}) {
 const [choice,setChoice]=useState(preference?.stage_id??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[conflict,setConflict]=useState(false);
 const unavailable=!!preference?.stage_id&&!stages.some(s=>s.id===preference.stage_id);
 async function save(clear=false){setBusy(true);setError('');setSaved(false);try{await studentAcademicRequest(undefined,{programId:id,stageId:clear?null:choice||null,revision:preference?.revision??0});setSaved(true);onSaved();}catch(e){setError(e instanceof Error?e.message:'Unable to save.');setConflict((e as {status?:number}).status===409);}finally{setBusy(false);}}
 return <div className="min-w-0 space-y-3 rounded-2xl border border-black/20 p-4"><label className="block text-sm font-bold">{label}<Dropdown aria-label={label+' stage'} className="mt-2 w-full min-w-0 rounded-xl border-2 border-black bg-background p-3 text-sm" value={choice} disabled={busy||conflict} onChange={e=>{setChoice(e.target.value);setSaved(false);}}><option value="">No stage selected</option>{unavailable&&<option value={preference!.stage_id!} disabled>Saved stage unavailable</option>}{stages.map(s=><option value={s.id} key={s.id}>{s.label}</option>)}</Dropdown></label>
 {(!stages.length)&&<p className="text-sm">No active stages are available in this program.</p>}
 {unavailable&&<p role="status" className="text-sm text-amber-900">Your saved stage is no longer available. Choose an active stage or clear this preference. Your courses remain accessible.</p>}
 <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||conflict||(!!choice&&!stages.some(s=>s.id===choice))} onClick={()=>void save()}>{busy?'Saving…':'Save stage'}</button><button className="text-sm underline disabled:opacity-50" disabled={busy||conflict||!preference?.stage_id} onClick={()=>void save(true)}>Clear selection</button></div>
 {saved&&<p role="status" className="text-sm">Stage preference saved.</p>}{error&&<div role="alert" className="space-y-2 text-sm text-red-800"><p>{error}</p><button className="underline" onClick={reload}>{conflict?'Discard draft and reload latest':'Reload choices'}</button></div>}
 </div>;
}
export function AcademicSelection({organizationId,onChange}:{organizationId?:string;onChange:(data:StudentAcademics|null,filter:string)=>void}) {
 const [data,setData]=useState<StudentAcademics|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[filter,setFilter]=useState('all'),[loaded,setLoaded]=useState<string|undefined>(),[notice,setNotice]=useState('');
 const reload=()=>{setData(null);setFilter('all');setVersion(v=>v+1);};
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');setLoaded(organizationId);setFilter('all');
  void studentAcademicRequest<StudentAcademics>(organizationId,undefined,controller.signal).then(v=>{if(!controller.signal.aborted)setData(v);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Choices unavailable.');});return()=>controller.abort();
 },[organizationId,version]);
 const current=loaded===organizationId?data:null;
 useEffect(()=>{onChange(current,filter);},[current,filter,onChange]);
 const saved=()=>{setNotice('Stage preference saved.');reload();};
 return <section className={panel} aria-label="Your academic stages"><h2 className="font-display text-xl">Your academic stages</h2><p className="mt-2 text-sm">Choose a stage for each program. Preferences help you find lessons; they never change your course access.</p>
 <div className="my-4 flex flex-wrap gap-3 [&_button[aria-pressed=true]]:ring-2 [&_button[aria-pressed=true]]:ring-black [&_button[aria-pressed=true]]:ring-offset-2" aria-label="Learning discovery"><button className={button} aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All My Courses</button><button className={button} disabled={!current} aria-pressed={filter==='selected'} onClick={()=>setFilter('selected')}>My selected stages &amp; general</button><button className={button} disabled={!current} aria-pressed={filter==='general'} onClick={()=>setFilter('general')}>General courses</button></div>
 {notice&&<p role="status" className="mb-3 text-sm">{notice}</p>}
 {error?<div role="alert" className="text-sm text-red-800"><p>{error} All your authorized courses are still shown.</p><button className="underline" onClick={reload}>Retry choices</button></div>:!current?<div role="status" className="animate-pulse rounded-xl bg-black/5 p-5">Loading academic choices…</div>:<>
 {!current.programs.length&&<p className="text-sm">No active academic programs available for your current enrollments.</p>}
 {current.organizations.map(org=><div className="mt-4 space-y-3" key={org.id}><h3 className="font-bold">{org.name}</h3><div className="grid gap-4 md:grid-cols-2">{current.programs.filter(p=>p.organization_id===org.id).map(p=><ProgramChoice key={p.id+':'+(current.preferences.find(x=>x.program_id===p.id)?.revision??0)+':'+version} id={p.id} label={p.label} stages={current.stages.filter(s=>s.program_id===p.id)} preference={current.preferences.find(x=>x.program_id===p.id)} reload={reload} onSaved={saved}/>)}</div>
 {current.preferences.filter(p=>p.organization_id===org.id&&!current.programs.some(x=>x.id===p.program_id)&&p.stage_id).map(p=><ProgramChoice key={p.program_id+':'+p.revision+':'+version} id={p.program_id} label="Unavailable saved program" stages={[]} preference={p} reload={reload} onSaved={saved}/>)}</div>)}
 <p className="mt-4 text-xs">General courses have no active classification visible to you. Archived classifications and learning history are preserved. Use All My Courses for other stages.</p>
 </>}
 </section>;
}

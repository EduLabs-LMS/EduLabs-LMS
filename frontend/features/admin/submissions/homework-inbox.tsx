'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useEffect,useState } from 'react';

import { Button } from '@/frontend/components/ui/button';

import { Input } from '@/frontend/components/ui/input';

import { Textarea } from '@/frontend/components/ui/textarea';

import { homeworkApi } from '@/frontend/lib/homework';

import type { HomeworkView,HomeworkSubmission } from '@/shared/contracts/homework';

import { HomeworkQuestion } from '@/frontend/features/courses/lesson/homework-question';

import { HomeworkReferenceImage } from '@/frontend/features/courses/lesson/homework-media';

import { HomeworkFileReview } from '@/frontend/features/courses/lesson/homework-file-review';

import { HomeworkHistory } from '@/frontend/features/courses/lesson/homework-history';

type Row={submission:HomeworkSubmission;assignmentId:string;title:string;userId:string;studentName:string;files:number;answers:number};

type Inbox={requestKey?:string;page:number;pageSize:number;total:number;rows:Row[]};

type Offering={id:string;name:string;courseId:string;courseTitle:string};

function Correction({view,onChange}:{view:HomeworkView;onChange:(v:HomeworkView)=>void}) {

 const s=view.submissions[0],c=s.correction!,d=view.definition;

 const [feedback,setFeedback]=useState(c.feedback),[reason,setReason]=useState(''),[score,setScore]=useState(c.score??0),[marks,setMarks]=useState<Record<string,{points:number;feedback:string}>>(Object.fromEntries(d.questions.filter(q=>q.type==='essay').map(q=>{const m=c.marks.find(m=>m.questionId===q.id);return [q.id,{points:m?.points??0,feedback:m?.feedback??''}];}))),[busy,setBusy]=useState(false),[error,setError]=useState('');

 async function action(action:string,data:unknown){setBusy(true);setError('');try{const submission=await homeworkApi<HomeworkSubmission>(view.id,'work',{action,submissionId:s.id,revision:c.revision,data});onChange({...view,submissions:[submission]});}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}}

 return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-display text-xl font-bold">{d.title} — Revision {s.number}</h2><p className="text-sm">{c.released?'Released correction':c.status==='under_correction'?'Under Correction':'Correction not released'}</p>{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}

  {d.questions.map((q,i)=>{const answer=s.answers.find(a=>a.questionId===q.id)??{questionId:q.id,optionIds:[],text:'',fileIds:[]},m=c.marks.find(v=>v.questionId===q.id);return <div key={q.id} className="space-y-2"><HomeworkQuestion question={q} number={i+1} answer={answer} onChange={()=>{}} disabled reference={q.imageId?<HomeworkReferenceImage assignmentId={view.id} id={q.imageId}/>:undefined}/>{q.correctIds.length>0&&<p className="text-xs">Correct option{q.correctIds.length>1?'s':''}: {q.correctIds.map(id=>String.fromCharCode(65+q.options.findIndex(o=>o.id===id))).join(', ')} · Automatic mark: {m?.points??'pending'}</p>}{q.modelAnswer&&<p className="text-xs whitespace-pre-wrap">Model answer: {q.modelAnswer}</p>}{q.type==='essay'&&<div className="space-y-2"><label className="text-sm">Written mark (maximum {q.points})<Input aria-label={`Question ${i+1} awarded marks`} type="number" min={0} max={q.points} disabled={busy||!view.canGrade} value={marks[q.id]?.points??0} onChange={e=>setMarks({...marks,[q.id]:{...marks[q.id],points:Number(e.target.value)}})}/></label><Textarea aria-label={`Question ${i+1} feedback`} disabled={busy||!view.canGrade} value={marks[q.id]?.feedback??''} onChange={e=>setMarks({...marks,[q.id]:{...marks[q.id],feedback:e.target.value}})}/></div>}</div>;})}

  <label className="block text-sm">Correction feedback<Textarea aria-label="Homework correction feedback" value={feedback} onChange={e=>setFeedback(e.target.value)} disabled={busy||!view.canGrade}/></label>

  {d.mode==='FILE_UPLOAD'&&d.usesMarks&&<label className="block text-sm">Mark (maximum {d.filePoints})<Input aria-label="Uploaded homework mark" type="number" min={0} max={d.filePoints} value={score} onChange={e=>setScore(Number(e.target.value))} disabled={busy||!view.canGrade}/></label>}

  <label className="block text-sm">Reason for changes after release<Input aria-label="Homework correction change reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={4000}/></label>

  <Button disabled={busy||!view.canGrade} onClick={()=>void action('grade',{score:d.mode==='FILE_UPLOAD'&&d.usesMarks?score:null,feedback,reason,marks:Object.entries(marks).map(([questionId,v])=>({questionId,...v}))}).catch(()=>{})}>Save correction</Button>

  {s.files.map(f=><HomeworkFileReview key={f.id} assignmentId={view.id} file={f} annotations={c.annotations} canAnnotate={view.canGrade&&!busy} onAnnotate={value=>action('annotate',{...value,id:null,annotationRevision:null,reason})}/>)}

  <div className="flex flex-wrap gap-2">{(['corrected','approved','resubmit_required'] as const).map(status=><Button key={status} variant={status==='resubmit_required'?'outline':'default'} disabled={busy||!view.canRelease} onClick={()=>void action('release',{status,reason}).catch(()=>{})}>{status==='resubmit_required'?'Request resubmission':status==='approved'?'Approve & release':'Release correction'}</Button>)}</div>{!view.canRelease&&<p className="text-xs">An assigned instructor or organization administrator must release the correction.</p>}

  <HomeworkHistory assignmentId={view.id} submissionId={s.id} files={s.files}/>

 </section>;

}

export function HomeworkInbox({offerings,limited=false}:{offerings:Offering[];limited?:boolean}) {

 const [course,setCourse]=useState(''),[offeringId,setOfferingId]=useState(offerings[0]?.id??''),[assignmentId,setAssignmentId]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(0),[inbox,setInbox]=useState<Inbox|null>(null),[view,setView]=useState<HomeworkView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);

 const [assignmentPage,setAssignmentPage]=useState(0),[assignmentSearch,setAssignmentSearch]=useState(''),[assignmentQuery,setAssignmentQuery]=useState(''),[assignmentOptions,setAssignmentOptions]=useState<{rows:{id:string;title:string;version:number;status:string}[];total:number|null}|null>(null),[assignmentError,setAssignmentError]=useState('');

 useEffect(()=>{if(!offeringId)return;let alive=true;setAssignmentOptions(null);setAssignmentError('');void homeworkApi<{rows:{id:string;title:string;version:number;status:string}[];total:number|null}>('new','assignments',{offeringId,search:assignmentQuery,page:assignmentPage}).then(v=>{if(alive)setAssignmentOptions(v);}).catch(e=>{if(alive)setAssignmentError(e.message);});return()=>{alive=false;};},[offeringId,assignmentPage,assignmentQuery]);

 const inboxKey=JSON.stringify([offeringId,assignmentId,query,page]),currentInbox=inbox?.requestKey===inboxKey?inbox:null;
 const courses=Array.from(new Map(offerings.map(o=>[o.courseId,o.courseTitle])).entries());

 useEffect(()=>{if(!offeringId)return;let alive=true;setError('');setInbox(null);void homeworkApi<Inbox>('new','inbox',{offeringId,assignmentId:assignmentId||null,search:query,page}).then(v=>{if(alive)setInbox({...v,requestKey:inboxKey});}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[offeringId,assignmentId,query,page,inboxKey]);

 return <div className="mx-auto max-w-7xl space-y-5 pb-16"><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h1 className="font-display text-3xl font-bold">Homework Submissions</h1><p className="text-sm text-slate-500">Review, annotate and release corrections for your assigned groups.</p></div>

  {limited&&<p role="status" className="text-sm">The course/group overview is limited. Open an individual course to narrow its groups; submissions remain paginated without a 100-row cap.</p>}

  {!offerings.length&&<p>No assigned course groups are available for correction.</p>}

  <div className="flex flex-wrap gap-3 rounded-2xl border bg-white p-4"><label className="text-sm">Course<Dropdown aria-label="Homework inbox course" className="block rounded-lg border p-2" value={course} onChange={e=>{setCourse(e.target.value);const o=offerings.find(o=>!e.target.value||o.courseId===e.target.value);setOfferingId(o?.id??'');setAssignmentId('');setAssignmentPage(0);setPage(0);setView(null);}}><option value="">All courses</option>{courses.map(([id,title])=><option key={id} value={id}>{title}</option>)}</Dropdown></label><label className="text-sm">Group<Dropdown aria-label="Homework inbox group" className="block rounded-lg border p-2" value={offeringId} onChange={e=>{setOfferingId(e.target.value);setPage(0);setAssignmentId('');setAssignmentPage(0);setView(null);}}>{offerings.filter(o=>!course||o.courseId===course).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</Dropdown></label><div className="space-y-2"><label className="text-sm">Assignment<Dropdown aria-label="Homework inbox assignment" className="block max-w-full rounded-lg border p-2" value={assignmentId} onChange={e=>{setAssignmentId(e.target.value);setPage(0);setView(null);}}><option value="">All assignments</option>{assignmentId&&!assignmentOptions?.rows.some(a=>a.id===assignmentId)&&<option value={assignmentId}>Selected assignment</option>}{assignmentOptions?.rows.map(a=><option key={a.id} value={a.id}>{a.title} · v{a.version} · {a.status}</option>)}</Dropdown></label>{assignmentError&&<p role="alert" className="text-red-700 text-xs">{assignmentError}</p>}{!assignmentOptions&&!assignmentError&&<p role="status" className="text-xs">Loading assignments…</p>}<form className="flex gap-2" onSubmit={e=>{e.preventDefault();setAssignmentPage(0);setAssignmentQuery(assignmentSearch);}}><Input aria-label="Find homework assignment" placeholder="Assignment title" maxLength={200} value={assignmentSearch} onChange={e=>setAssignmentSearch(e.target.value)}/><Button size="sm" variant="outline">Find</Button></form><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!assignmentOptions||assignmentPage===0} onClick={()=>setAssignmentPage(assignmentPage-1)}>Previous assignments</Button><Button size="sm" variant="outline" disabled={!assignmentOptions||(assignmentPage+1)*25>=(assignmentOptions.total??0)} onClick={()=>setAssignmentPage(assignmentPage+1)}>Next assignments</Button></div></div><form className="flex gap-2 items-end" onSubmit={e=>{e.preventDefault();setPage(0);setQuery(search);}}><Input aria-label="Homework student search" placeholder="Student name or ID" value={search} onChange={e=>setSearch(e.target.value)} maxLength={200}/><Button>Search</Button></form></div>

  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{offeringId&&!currentInbox&&!error&&<p role="status">Loading submissions…</p>}

  {currentInbox&&<section className="space-y-3 rounded-2xl border bg-white p-4"><p className="text-xs">{currentInbox.total} submissions · Page {page+1}</p>{!currentInbox.rows.length&&<p className="text-sm">No submitted homework matches these filters.</p>}{currentInbox.rows.map(r=><button key={r.submission.id} disabled={busy} className="w-full flex flex-wrap justify-between gap-2 rounded-xl border p-4 text-left hover:bg-slate-50" onClick={async()=>{setBusy(true);setError('');try{setView(await homeworkApi<HomeworkView>(r.assignmentId,'get',{submissionId:r.submission.id}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><span className="font-semibold text-sm">{r.studentName||r.userId} · {r.title}</span><span className="text-xs">{r.submission.correction?.status.replaceAll('_',' ')} · {r.files} files · {r.answers} answers · {r.submission.submittedAt}</span></button>)}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={page===0} onClick={()=>{setPage(page-1);setView(null);}}>Previous submissions</Button><Button variant="outline" disabled={(page+1)*25>=currentInbox.total} onClick={()=>{setPage(page+1);setView(null);}}>Next submissions</Button></div></section>}

  {view&&view.submissions[0]&&<Correction key={view.submissions[0].id} view={view} onChange={setView}/>}

 </div>;

}

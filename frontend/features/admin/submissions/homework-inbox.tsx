'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useEffect,useState } from 'react';

import { Button } from '@/frontend/components/ui/button';

import { Input } from '@/frontend/components/ui/input';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { cn } from '@/shared/utils';
import { Chip, EmptyState, PageHeader, SearchField, SkeletonList, buttonClass, card, fieldClass, primaryButtonClass } from '@/frontend/components/page-kit';

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

 return <section className="m-pop space-y-4 rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6"><h2 className="font-display text-xl font-bold">{d.title} — Revision {s.number}</h2><p className="text-sm">{c.released?'Released correction':c.status==='under_correction'?'Under Correction':'Correction not released'}</p>{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}

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

 return <div className="mx-auto max-w-7xl space-y-6 pb-16">
  <PageHeader icon={<ClipboardCheck aria-hidden className="h-7 w-7"/>} title="Homework Submissions" subtitle="Review, annotate and release corrections for your assigned groups."/>

  {limited&&<p role="status" className="text-sm">The course/group overview is limited. Open an individual course to narrow its groups; submissions remain paginated without a 100-row cap.</p>}

  {!offerings.length&&<EmptyState icon={<ClipboardCheck className="h-8 w-8"/>} title="No assigned course groups" note="No assigned course groups are available for correction."/>}

  <section className={cn(card,'space-y-4')}>
   <div className="grid gap-4 md:grid-cols-3">
    <label className="block text-sm font-semibold">Course<Dropdown aria-label="Homework inbox course" className={cn(fieldClass,'mt-1')} value={course} onChange={e=>{setCourse(e.target.value);const o=offerings.find(o=>!e.target.value||o.courseId===e.target.value);setOfferingId(o?.id??'');setAssignmentId('');setAssignmentPage(0);setPage(0);setView(null);}}><option value="">All courses</option>{courses.map(([id,title])=><option key={id} value={id}>{title}</option>)}</Dropdown></label>
    <label className="block text-sm font-semibold">Group<Dropdown aria-label="Homework inbox group" className={cn(fieldClass,'mt-1')} value={offeringId} onChange={e=>{setOfferingId(e.target.value);setPage(0);setAssignmentId('');setAssignmentPage(0);setView(null);}}>{offerings.filter(o=>!course||o.courseId===course).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</Dropdown></label>
    <label className="block text-sm font-semibold">Assignment<Dropdown aria-label="Homework inbox assignment" className={cn(fieldClass,'mt-1')} value={assignmentId} onChange={e=>{setAssignmentId(e.target.value);setPage(0);setView(null);}}><option value="">All assignments</option>{assignmentId&&!assignmentOptions?.rows.some(a=>a.id===assignmentId)&&<option value={assignmentId}>Selected assignment</option>}{assignmentOptions?.rows.map(a=><option key={a.id} value={a.id}>{a.title} · v{a.version} · {a.status}</option>)}</Dropdown></label>
   </div>
   {assignmentError&&<p role="alert" className="text-xs text-red-800">{assignmentError}</p>}{!assignmentOptions&&!assignmentError&&<p role="status" className="text-xs">Loading assignments…</p>}
   <details className="text-sm"><summary className="min-h-[44px] cursor-pointer py-2 font-bold">Find an assignment</summary>
    <div className="space-y-3 pb-2"><form className="flex gap-2" onSubmit={e=>{e.preventDefault();setAssignmentPage(0);setAssignmentQuery(assignmentSearch);}}><Input aria-label="Find homework assignment" placeholder="Assignment title" maxLength={200} value={assignmentSearch} onChange={e=>setAssignmentSearch(e.target.value)}/><button className={buttonClass}>Find</button></form>
     <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!assignmentOptions||assignmentPage===0} onClick={()=>setAssignmentPage(assignmentPage-1)}>Previous assignments</button><button type="button" className={buttonClass} disabled={!assignmentOptions||(assignmentPage+1)*25>=(assignmentOptions.total??0)} onClick={()=>setAssignmentPage(assignmentPage+1)}>Next assignments</button></div></div></details>
   <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setPage(0);setQuery(search);}}><SearchField className="flex-1" label="Homework student search" placeholder="Student name or ID" value={search} onChange={setSearch}/><button className={primaryButtonClass}>Search</button></form>
  </section>

  {error&&<p role="alert" className="rounded-2xl border-2 border-red-800 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
  {offeringId&&!currentInbox&&!error&&<div role="status"><span className="sr-only">Loading submissions…</span><SkeletonList rows={3}/></div>}

  {currentInbox&&<section className="space-y-3">
   <p className="text-sm font-semibold text-slate-700">{currentInbox.total} submissions · Page {page+1}</p>
   {!currentInbox.rows.length&&<EmptyState icon={<ClipboardCheck className="h-8 w-8"/>} title="Nothing to review here" note="No submitted homework matches these filters."/>}
   <div className="m-list space-y-3">{currentInbox.rows.map(r=>{const status=(r.submission.correction?.status??'').replaceAll('_',' ');return <button key={r.submission.id} disabled={busy} className="flex w-full items-center gap-4 rounded-2xl border-2 border-black bg-white p-4 text-start shadow-hard-sm transition-transform hover:-translate-y-px disabled:opacity-60" onClick={async()=>{setBusy(true);setError('');try{setView(await homeworkApi<HomeworkView>(r.assignmentId,'get',{submissionId:r.submission.id}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
     <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-black bg-primary font-bold">{(Array.from((r.studentName||r.userId||'?').trim())[0]??'?').toUpperCase()}</span>
     <span className="min-w-0 flex-1"><span className="block break-words font-semibold"><bdi dir="auto">{r.studentName||r.userId}</bdi> · {r.title}</span><span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">{status&&<Chip tone={/release/i.test(status)?'good':'warn'} className="capitalize">{status.toLowerCase()}</Chip>}<span>{r.files} files · {r.answers} answers · {r.submission.submittedAt}</span></span></span>
     <ChevronRight aria-hidden className="h-5 w-5 shrink-0 rtl:rotate-180"/></button>;})}</div>
   <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={page===0} onClick={()=>{setPage(page-1);setView(null);}}>Previous submissions</button><button className={buttonClass} disabled={(page+1)*25>=currentInbox.total} onClick={()=>{setPage(page+1);setView(null);}}>Next submissions</button></div>
  </section>}

  {view&&view.submissions[0]&&<Correction key={view.submissions[0].id} view={view} onChange={setView}/>}

 </div>;

}

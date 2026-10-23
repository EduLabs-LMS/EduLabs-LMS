'use client';

import { L, Localized } from '@/frontend/components/language-provider';
import { useEffect,useState } from 'react';

import { Button } from '@/frontend/components/ui/button';

import { Input } from '@/frontend/components/ui/input';

import { homeworkApi,uploadHomeworkFile } from '@/frontend/lib/homework';

import type { HomeworkView,HomeworkSubmission,HomeworkAnswer,HomeworkFile } from '@/shared/contracts/homework';

import { HomeworkQuestion } from './homework-question';

import { HomeworkMedia,HomeworkReferenceImage,HomeworkSolutionVideo } from './homework-media';

import { HomeworkFileReview } from './homework-file-review';

import { HomeworkHistory } from './homework-history';

export function HomeworkStudent({initial,preview=false}:{initial:HomeworkView;preview?:boolean}) {

 const [view,setView]=useState(initial),[submission,setSubmission]=useState(initial.submissions[0]??null),[answers,setAnswers]=useState<HomeworkAnswer[]>(initial.submissions[0]?.answers??[]),[files,setFiles]=useState<HomeworkFile[]>(initial.submissions[0]?.files??[]),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[uploadProgress,setUploadProgress]=useState<number|null>(null);

 const [historyPage,setHistoryPage]=useState(0),[history,setHistory]=useState<{rows:HomeworkSubmission[];total:number;page:number}|null>(null),[historyError,setHistoryError]=useState('');

 useEffect(()=>{if(preview)return;let alive=true;setHistory(null);setHistoryError('');void homeworkApi<{rows:HomeworkSubmission[];total:number;page:number}>(view.id,'revisions',{page:historyPage}).then(v=>{if(alive)setHistory(v);}).catch(e=>{if(alive)setHistoryError(e.message);});return()=>{alive=false;};},[view,preview,historyPage]);

 const visibleHistory=history?.page===historyPage?history:null;
 const d=view.definition,readOnly=!preview&&submission?.status==='submitted';

 const change=(v:HomeworkAnswer)=>{setAnswers(old=>[...old.filter(a=>a.questionId!==v.questionId),v]);setDirty(true);setMessage('Unsaved changes');};

 async function refresh(){const next=await homeworkApi<HomeworkView>(view.id,'get',{});setView(next);const s=next.submissions[0]??null;setSubmission(s);setAnswers(s?.answers??[]);setFiles(s?.files??[]);setDirty(false);return next;}

 async function work(action:string,s=submission,data:unknown={}){return homeworkApi<HomeworkSubmission>(view.id,'work',{action,submissionId:s?.id??null,revision:s?.revision??null,data});}

 async function saveSnapshot(nextAnswers=answers,nextFiles=files){if(!submission)throw new Error('Start your homework first.');const saved=await work('save',submission,{answers:nextAnswers,fileIds:d.mode==='FILE_UPLOAD'?nextFiles.map(f=>f.id):[]});setSubmission(saved);setDirty(false);setMessage('Draft saved on the server');return saved;}

 async function upload(selected:File[],questionId?:string){if(!submission||submission.status!=='draft')return;setBusy(true);setError('');setMessage('');let nextFiles=[...files],nextAnswers=[...answers];try{if(files.length+selected.length>10)throw new Error('Maximum ten files per submission.');if(questionId&&(answers.find(a=>a.questionId===questionId)?.fileIds.length??0)+selected.length>4)throw new Error('Maximum four files per written answer.');for(const file of selected){setUploadProgress(0);const uploaded=await uploadHomeworkFile(view.id,file,'submission',submission.id,setUploadProgress);nextFiles=[...nextFiles,uploaded];if(questionId){const previous=nextAnswers.find(v=>v.questionId===questionId)??{questionId,optionIds:[],text:'',fileIds:[]};if(previous.fileIds.length>=4){await homeworkApi(view.id,'cleanup',{id:uploaded.id});throw new Error('Maximum four files per written answer.');}nextAnswers=[...nextAnswers.filter(v=>v.questionId!==questionId),{...previous,fileIds:[...previous.fileIds,uploaded.id]}];}}setFiles(nextFiles);setAnswers(nextAnswers);await saveSnapshot(nextAnswers,nextFiles);}catch(e){setFiles(nextFiles);setAnswers(nextAnswers);setDirty(true);setError(e instanceof Error?e.message:'Upload failed');}finally{setBusy(false);setUploadProgress(null);}}

 return <section className="space-y-4 rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm">

  <h2 className="font-display text-xl font-bold">{d.title||<L id="homework.preview"/>}</h2><span className="text-xs rounded-full border px-3 py-1">{d.mode==='FILE_UPLOAD'?<L id="homework.fileMode"/>:<L id="homework.platformMode"/>}</span>{d.instructions&&<p className="whitespace-pre-wrap text-sm break-words">{d.instructions}</p>}

  {view.references.map(f=><HomeworkMedia key={f.id} assignmentId={view.id} id={f.id}/>)}

  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{message&&<p role="status" className="text-sm">{message}</p>}

  {uploadProgress!==null&&<div><Localized as="progress" labels={{"aria-label":"homework.homework_upload_progress"}} value={uploadProgress} max={100} className="w-full"/><p className="text-xs">{uploadProgress<100?`Uploading ${uploadProgress}%`:<L id="homework.validating"/>}</p></div>}

  {!preview&&!submission&&<Button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const s=await work('start');setSubmission(s);setAnswers(s.answers);setFiles(s.files);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><L id="homework.start_homework"/></Button>}

  {d.mode==='FILE_UPLOAD'?<div className="space-y-3"><p className="text-xs"><L id="homework.up_to_ten_files_pdf"/></p><label className="block text-sm"><L id="homework.choose_completed_work"/><Localized as={Input} labels={{"aria-label":"homework.homework_files"}} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy||preview||!submission||readOnly} onChange={e=>void upload(Array.from(e.target.files??[]))}/></label><label className="block text-sm"><L id="homework.take_a_handwritten_work_photo"/><Localized as={Input} labels={{"aria-label":"homework.homework_camera"}} type="file" capture="environment" accept="image/*" disabled={busy||preview||!submission||readOnly} onChange={e=>void upload(Array.from(e.target.files??[]))}/></label></div>:

  <div className="space-y-3">{d.questions.map((q,i)=><HomeworkQuestion key={q.id} question={q} number={i+1} answer={answers.find(a=>a.questionId===q.id)??{questionId:q.id,optionIds:[],text:'',fileIds:[]}} onChange={change} disabled={busy||readOnly||!preview&&!submission} reference={q.imageId?<HomeworkReferenceImage assignmentId={view.id} id={q.imageId}/>:undefined} upload={preview?undefined:f=>upload([f],q.id)} files={files.filter(f=>answers.find(a=>a.questionId===q.id)?.fileIds.includes(f.id))}/>)}</div>}

  {!preview&&submission?.status==='draft'&&<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy||!dirty} onClick={async()=>{setBusy(true);setError('');try{await saveSnapshot();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><L id="homework.save_draft"/></Button><Button disabled={busy} onClick={async()=>{setBusy(true);setError('');setMessage('');try{const saved=dirty?await saveSnapshot():submission;const result=await work('submit',saved);setSubmission(result);await refresh();setMessage('Homework submitted successfully. Your solutions are now unlocked.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><L id="homework.submit_homework"/></Button></div>}

  {readOnly&&<div className="rounded-xl border bg-slate-50 p-4 space-y-2"><p className="font-semibold text-sm"><L id="homework.submitted_revision"/>{" "}{submission.number} · {submission.submittedAt?new Date(submission.submittedAt).toLocaleString():''}</p><p className="text-sm">{submission.correction?.status==='under_correction'?<L id="exams.under_correction_"/>:submission.correction?.status==='submitted'?<L id="homework.awaiting"/>:submission.correction?.status?.replaceAll('_',' ')}</p>{submission.correction?.released&&<><p className="whitespace-pre-wrap text-sm">{submission.correction.feedback}</p>{submission.correction.score!==null&&<p className="font-bold"><L id="homework.mark"/>{" "}{submission.correction.score}</p>}</>}

   {submission.correction?.released&&submission.correction.status==='resubmit_required'&&<Button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await work('start');await refresh();setMessage('New revision created. Your earlier submission remains in history.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><L id="homework.prepare_requested_revision"/></Button>}

  </div>}

  {!preview&&files.map(f=>readOnly&&submission?.correction?.released?<HomeworkFileReview key={f.id} assignmentId={view.id} file={f} annotations={submission.correction.annotations}/>:<div key={f.id} className="flex gap-2 items-center"><HomeworkMedia assignmentId={view.id} id={f.id}/>{!readOnly&&<Button size="sm" variant="outline" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const nextFiles=files.filter(v=>v.id!==f.id),nextAnswers=answers.map(a=>({...a,fileIds:a.fileIds.filter(v=>v!==f.id)}));await saveSnapshot(nextAnswers,nextFiles);setFiles(nextFiles);setAnswers(nextAnswers);try{await homeworkApi(view.id,'cleanup',{id:f.id});}catch{setError('The file was removed from your saved draft, but its private original is retained for safe cleanup.');}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><L id="homework.remove_from_draft"/></Button>}</div>)}

  {!preview&&<details><summary className="cursor-pointer text-sm font-semibold"><L id="homework.submission_history"/>{visibleHistory?` (${visibleHistory.total})`:''}</summary>{historyError&&<p role="alert">{historyError}</p>}{!visibleHistory&&!historyError&&<p role="status"><L id="homework.loading_history"/></p>}{visibleHistory?.rows.map(s=><div key={s.id} className="space-y-2 border rounded-xl p-3 mt-2"><p className="text-sm"><L id="homework.revision"/>{" "}{s.number} · {s.submittedAt}</p>{s.correction?.released&&<p className="text-sm">{s.correction.feedback} {s.correction.score!==null?`· Mark ${s.correction.score}`:''}</p>}{s.answers.map(a=><HomeworkQuestion key={a.questionId} question={d.questions.find(q=>q.id===a.questionId)!} number={d.questions.findIndex(q=>q.id===a.questionId)+1} answer={a} onChange={()=>{}} disabled/>)}{s.files.map(f=><HomeworkFileReview key={f.id} assignmentId={view.id} file={f} annotations={s.correction?.released?s.correction.annotations:[]}/>)}</div>)}<div className="flex gap-2 mt-2"><Button variant="outline" disabled={!visibleHistory||historyPage===0} onClick={()=>setHistoryPage(historyPage-1)}><L id="homework.newer_revisions"/></Button><Button variant="outline" disabled={!visibleHistory||(historyPage+1)*25>=visibleHistory.total} onClick={()=>setHistoryPage(historyPage+1)}><L id="homework.older_revisions"/></Button></div></details>}

  {!preview&&submission?.status==='submitted'&&<HomeworkHistory assignmentId={view.id} submissionId={submission.id} files={submission.files}/>}

  <section className="border-t pt-4 space-y-3"><h3 className="font-bold text-sm"><L id="homework.model_answers_solution_walkthrough"/></h3>{!preview&&view.solutions?<><p className="whitespace-pre-wrap text-sm">{view.solutions.text||<L id="homework.noModel"/>}</p>{view.solutions.videoId?<HomeworkMedia assignmentId={view.id} id={view.solutions.videoId} video/>:view.solutions.video?<HomeworkSolutionVideo url={view.solutions.video}/>:null}{view.solutions.files.map(f=><HomeworkMedia key={f.id} assignmentId={view.id} id={f.id}/>)}{view.solutions.keys.map(k=><div className="text-sm" key={k.questionId}><strong><L id="homework.q"/>{d.questions.findIndex(q=>q.id===k.questionId)+1}:</strong> {k.correctIds.map(id=>String.fromCharCode(65+(d.questions.find(q=>q.id===k.questionId)?.options.findIndex(o=>o.id===id)??0))).join(', ')}{k.modelAnswer&&<p className="whitespace-pre-wrap">{k.modelAnswer}</p>}</div>)}</>:<p className="text-sm text-slate-500"><L id="homework.submit_your_homework_successfully_to"/></p>}</section>

 </section>;

}

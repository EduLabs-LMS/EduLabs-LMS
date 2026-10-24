'use client';
import { L } from '@/frontend/components/language-provider';
import { useEffect,useState } from 'react';
import { Button } from '@/frontend/components/ui/button';
import { homeworkApi } from '@/frontend/lib/homework';
import { homeworkAssignmentLabel,type HomeworkView } from '@/shared/contracts/homework';
import { TeacherFoundationNotice } from '@/frontend/components/teacher-foundation-notice';
import { HomeworkStudent } from './homework-student';
type List={rows:{id:string;title:string;status:string;mode:string;offering_id:string;version:number}[];hasMore:boolean;total:number|null};
export function HomeworkAssignments(props:{courseId:string;lessonId:string;segmentId:string|null;offeringId?:string|null;teacher?:boolean}) {
 return props.teacher?<TeacherFoundationNotice title="Homework authoring"/>:<StudentHomeworkAssignments {...props}/>;
}
function StudentHomeworkAssignments({courseId,lessonId,segmentId,offeringId=null,teacher=false}:{courseId:string;lessonId:string;segmentId:string|null;offeringId?:string|null;teacher?:boolean}) {
 const [list,setList]=useState<List|null>(null),[view,setView]=useState<HomeworkView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(0);
 async function refresh(id?:string){setError('');setBusy(true);try{const next=await homeworkApi<List>('new','list',{courseId,lessonId,segmentId,offeringId,page});setList(next);if(id){setView(await homeworkApi<HomeworkView>(id,'get',{}));}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{let alive=true;setList(null);setError('');void homeworkApi<List>('new','list',{courseId,lessonId,segmentId,offeringId,page}).then(v=>{if(alive)setList(v);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[courseId,lessonId,segmentId,offeringId,page,teacher]);
 return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mt-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-xl font-bold"><L id="homework.homework"/></h2></div>
  {error&&<div role="alert" className="text-sm text-red-700">{error}<Button variant="outline" size="sm" onClick={()=>void refresh()}><L id="home.retry"/></Button></div>}
  {!list&&!error&&<p role="status" className="text-sm"><L id="homework.loading_authorized_homework"/></p>}
  {list?.rows.length===0&&!error&&<p className="text-sm text-slate-500">{teacher?<L id="homework.noneTeacher"/>:<L id="homework.noneStudent"/>}</p>}
  <div className="flex flex-wrap gap-2">{list?.rows.map(a=><Button variant="outline" key={a.id} disabled={busy} onClick={()=>void refresh(a.id)}>{homeworkAssignmentLabel(a,teacher)}</Button>)}</div>
  {(page>0||list?.hasMore)&&<div className="flex gap-2 items-center"><Button size="sm" variant="outline" disabled={page===0} onClick={()=>setPage(page-1)}><L id="homework.previous_assignments"/></Button><span className="text-xs"><L id="notifications.page"/>{" "}{page+1}</span><Button size="sm" variant="outline" disabled={!list?.hasMore} onClick={()=>setPage(page+1)}><L id="homework.next_assignments"/></Button></div>}

  {!teacher&&view&&<HomeworkStudent key={view.id} initial={view}/>}
 </section>;
}

'use client';
import { useCallback, useState } from 'react';
import StudentHome from '@/frontend/features/dashboard/student-home';
import { SelfLearningView } from '@/frontend/features/self-learning/self-learning-view';
import { AcademicSelection } from './academic-selection';
import { academicCourseIds } from '@/shared/contracts/student-academics';
import type { StudentAcademics } from '@/shared/contracts/student-academics';
import type { StudentLesson, SelfLearningChapter } from '@/shared/contracts/dashboard';
export function StudentLearning({organizationId,lessons,chapters,offerings,home=false,limited=false}:{organizationId?:string;lessons:StudentLesson[];chapters:SelfLearningChapter[];offerings:{id:string;course_id:string}[];home?:boolean;limited?:boolean}) {
 return <ScopedStudentLearning key={organizationId??'all'} organizationId={organizationId} lessons={lessons} chapters={chapters} offerings={offerings} home={home} limited={limited}/>;
}
function ScopedStudentLearning({organizationId,lessons,chapters,offerings,home=false,limited=false}:{organizationId?:string;lessons:StudentLesson[];chapters:SelfLearningChapter[];offerings:{id:string;course_id:string}[];home?:boolean;limited?:boolean}) {
 const [selection,setSelection]=useState<{data:StudentAcademics|null;filter:string}>({data:null,filter:'all'});
 const change=useCallback((data:StudentAcademics|null,filter:string)=>setSelection({data,filter}),[]);
 const courses=offerings.map(o=>o.course_id),ids=selection.data?academicCourseIds(courses,selection.data,selection.filter):courses;
 const visible=new Set(offerings.filter(o=>ids.includes(o.course_id)).map(o=>o.id));
 const filtered=selection.data&&selection.filter!=='all';
 return <div className="space-y-8"><AcademicSelection organizationId={organizationId} onChange={change}/>
 {filtered&&<p role="status" className="text-sm">Showing {selection.filter==='general'?'general courses':'your selected stages and general courses'}. Other enrolled courses remain available through All My Courses.</p>}
 {home?<StudentHome phase1 summaryAvailable={!limited} lessons={lessons} discoveryLessonIds={filtered?lessons.filter(l=>visible.has(l.id.split(':')[0])).map(l=>l.id):undefined} groupName={null}/>:filtered&&!chapters.some(c=>visible.has((c.id??'').split(':')[0]))?<p role="status" className="rounded-2xl border border-dashed p-8 text-center text-sm">No lessons match this discovery filter. Choose All My Courses to view your other lessons.</p>:<SelfLearningView chapters={chapters.filter(c=>visible.has((c.id??'').split(':')[0]))}/>}
 </div>;
}

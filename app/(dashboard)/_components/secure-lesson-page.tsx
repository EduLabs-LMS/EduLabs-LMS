import Link from 'next/link';
import { notFound,redirect } from 'next/navigation';
import { learningService } from '@/server/services/lessons';
import { getApplicationViewer } from '@/server/services/application-auth';
import LessonTabs from '@/frontend/features/courses/lesson/lesson-tabs';
import { lessonId } from '@/shared/contracts/lessons';
import { studentLessonPage } from '@/server/services/student-lesson-page';
import { HomeworkAssignments } from '@/frontend/features/courses/lesson/homework-assignments';

export async function SecureLessonPage({courseId,segmentId,offeringId}:{courseId:string;segmentId:string;offeringId?:string}) {
 if(!await getApplicationViewer())redirect('/sign-in');
 if(!lessonId.safeParse(courseId).success||!lessonId.safeParse(segmentId).success||!lessonId.safeParse(offeringId).success)notFound();
 return <LessonContent courseId={courseId} segmentId={segmentId} offeringId={offeringId!}/>;
}
// The group and enrollment check runs first, then the course outline and the opened lesson's content only (studentLessonPage).
async function LessonContent({courseId,segmentId,offeringId}:{courseId:string;segmentId:string;offeringId:string}) {
 try {
 const page=await studentLessonPage(await learningService(courseId),courseId,segmentId,offeringId);
 if(page.kind==='unavailable')return <UnavailableLesson/>;
 return <div className="mx-auto max-w-7xl"><LessonTabs key={page.key} {...page.tabs}/><HomeworkAssignments key={`hw:${page.homework.segmentId}`} {...page.homework}/></div>;
 }catch(e){const status=(e as {status?:number}).status;return <UnavailableLesson failed={status===503} tooLarge={status===413}/>;}
}
// A size limit is never reported as "unpublished or expired" (A2a-01).
function UnavailableLesson({failed=false,tooLarge=false}:{failed?:boolean;tooLarge?:boolean}) {return <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3"><p role="alert">{tooLarge?'This lesson is too large to show. Please tell your teacher.':failed?'Lessons could not be loaded. Please retry.':'This lesson is unpublished, unavailable or your enrollment has expired.'}</p><Link className="text-sky-700 font-semibold" href="/self-learning">Return to your lessons</Link></div>;}

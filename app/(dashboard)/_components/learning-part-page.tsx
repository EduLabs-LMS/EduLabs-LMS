import { isFirebaseStaging } from '@/shared/auth-config';
import { notFound,redirect } from 'next/navigation';
import { getApplicationViewer } from '@/server/services/application-auth';
import { learningService } from '@/server/services/lessons';
import { lessonId } from '@/shared/contracts/lessons';
import { TeacherFoundationPage } from './teacher-foundation-page';
export async function LearningPartPage({courseId,segmentId}:{courseId:string;segmentId:string;preview?:boolean}) {
 if(!isFirebaseStaging())return <TeacherFoundationPage title="Course management"/>;
 if(!await getApplicationViewer())redirect('/sign-in');
 if(!lessonId.safeParse(courseId).success||!lessonId.safeParse(segmentId).success)notFound();
 const service=await learningService(courseId,true);const tree=await service.tree();
 if(!tree.segments.some(s=>s.id===segmentId))notFound();
 return <TeacherFoundationPage title="Lesson editor"/>;
}

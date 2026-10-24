import { isFirebaseStaging } from '@/shared/auth-config';
import { notFound,redirect } from 'next/navigation';
import { z } from 'zod';
import { getWebsiteContext } from '@/server/services/website';
import { editableTeacherCourse } from '@/server/services/teacher-course';
import { TeacherFoundationPage } from './teacher-foundation-page';
export async function TeacherEditor({courseId,onboarding=false}:{courseId?:string;onboarding?:boolean}) {
 if(!isFirebaseStaging())return <TeacherFoundationPage title="Course management"/>;
 const context=await getWebsiteContext();if(!context)redirect('/sign-in');
 if(onboarding)notFound();
 if(courseId){if(!z.string().uuid().safeParse(courseId).success)notFound();if(!await editableTeacherCourse(context.viewer.id,courseId))notFound();}
 return <TeacherFoundationPage title={courseId?'Course editor':'Create course'}/>;
}

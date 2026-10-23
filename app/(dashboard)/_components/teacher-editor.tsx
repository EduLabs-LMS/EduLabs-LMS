import { learningService } from '@/server/services/lessons';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { getWebsiteContext } from '@/server/services/website';
import { editableTeacherCourse } from '@/server/services/teacher-course';
import V2CourseCreate from '@/frontend/features/teacher/courses/course-create';
import { V2TeacherCourseEditor } from '@/frontend/features/teacher/courses/course-editor';
import { TeacherForm } from '@/frontend/features/teacher/courses/teacher-form';
export async function TeacherEditor({courseId,onboarding=false}:{courseId?:string;onboarding?:boolean}) {
  const context=await getWebsiteContext(); if(!context) redirect('/sign-in');
  if(courseId&&!z.string().uuid().safeParse(courseId).success) notFound();
  const course=courseId?await editableTeacherCourse(context.viewer.id,courseId):undefined;
  if(courseId&&!course) notFound();
  const organizations=context.organizations.filter(o=>context.memberships.some(m=>m.organization_id===o.id&&m.status==='active'&&['owner','admin','teacher'].includes(m.role)));
  if (!onboarding && !course && organizations.length) return <V2CourseCreate organizations={organizations}/>;
  if (course) return <V2TeacherCourseEditor key={course.updated_at} record={course} tree={await (await learningService(course.id,true)).tree()}/>;
  return <div className="mx-auto max-w-5xl space-y-6 pb-16 pt-2"><Link className="text-sm text-slate-500 hover:text-sky-700" href="/self-learning">← Your courses</Link><h1 className="text-3xl font-bold">{onboarding?'Create your organization':course?'Course editor':'Create a course'}</h1>
    {onboarding&&<p className="text-slate-500">You will own this new organization. This does not grant access to any other organization.</p>}
    <TeacherForm key="new" organizations={organizations} onboarding={onboarding}/>
  </div>;
}

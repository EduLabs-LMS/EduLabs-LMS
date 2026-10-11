import { T } from '@/frontend/design/preferences';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { getWebsiteContext } from '@/server/services/website';
import { editableTeacherCourse } from '@/server/services/teacher-course';
import { TeacherForm } from '@/frontend/features/teacher/courses/teacher-form';
export async function TeacherEditor({courseId,onboarding=false}:{courseId?:string;onboarding?:boolean}) {
  const context=await getWebsiteContext(); if(!context) redirect('/sign-in');
  if(courseId&&!z.string().uuid().safeParse(courseId).success) notFound();
  const course=courseId?await editableTeacherCourse(context.viewer.id,courseId):undefined;
  if(courseId&&!course) notFound();
  const organizations=context.organizations.filter(o=>context.memberships.some(m=>m.organization_id===o.id&&m.status==='active'&&['owner','admin','teacher'].includes(m.role)));
  return <div className="mx-auto max-w-5xl space-y-6 pb-16 pt-2"><Link className="text-sm text-slate-500 hover:text-sky-700" href="/teacher/courses"><T>{"← Your courses"}</T></Link><h1 className="text-3xl font-bold">{onboarding?<T>{"Create your organization"}</T>:course?<T>{"Course editor"}</T>:<T>{"Create a course"}</T>}</h1>
    {onboarding&&<p className="text-slate-500"><T>{"You will own this new organization. This does not grant access to any other organization."}</T></p>}
    <TeacherForm key={course?.updated_at??'new'} course={course??undefined} organizations={organizations} onboarding={onboarding}/>
  </div>;
}

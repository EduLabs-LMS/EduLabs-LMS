import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getDbUser } from '@/server/services/user';
import { getWebsiteContext } from '@/server/services/website';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationNotice } from '@/frontend/components/teacher-foundation-notice';
export async function TeacherFoundationPage({title}:{title:string}) {
 if(isFirebaseStaging()) {
  const context=await getWebsiteContext();if(!context)redirect('/sign-in');
  if(!context.memberships.some(m=>m.status==='active') || !(context.courseStaff.length || context.offeringStaff.length || context.memberships.some(m=>m.status==='active'&&['owner','admin','teacher','assistant'].includes(m.role))))redirect('/home');
 } else {
  const {userId}=await auth();if(!userId)redirect('/sign-in');
  const user=await getDbUser(userId);if(!user||['student','STUDENT'].includes(user.role))redirect('/home');
 }
 return <TeacherFoundationNotice title={title}/>;
}

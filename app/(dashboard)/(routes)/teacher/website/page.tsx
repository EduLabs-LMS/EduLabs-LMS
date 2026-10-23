import { redirect } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getWebsiteContext } from '@/server/services/website';
import { TeacherWebsiteWorkspace } from '@/frontend/features/teacher/website/website-workspace';
export default async function TeacherWebsitePage(){
 if(!isFirebaseStaging())redirect('/self-learning');
 const context=await getWebsiteContext();if(!context)redirect('/sign-in');
 const organizations=context.organizations.filter(o=>o.status==='active'&&context.memberships.some(m=>m.organization_id===o.id&&m.status==='active'));
 return <TeacherWebsiteWorkspace organizations={organizations.map(o=>({id:o.id,name:o.name}))}/>;
}

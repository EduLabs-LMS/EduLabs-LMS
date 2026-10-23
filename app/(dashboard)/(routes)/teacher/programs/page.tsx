import { redirect } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getWebsiteContext } from '@/server/services/website';
import { AcademicWorkspace } from '@/frontend/features/teacher/academics/program-workspace';

export default async function AcademicProgramsPage() {
 if(!isFirebaseStaging())redirect('/self-learning');
 const context=await getWebsiteContext();if(!context)redirect('/sign-in');
 const organizations=context.organizations.filter(o=>o.status==='active'&&context.memberships.some(m=>m.organization_id===o.id&&m.status==='active'));
 return <AcademicWorkspace organizations={organizations.map(o=>({id:o.id,name:o.name}))}/>;
}

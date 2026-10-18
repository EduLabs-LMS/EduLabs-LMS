import { redirect } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getApplicationViewer } from '@/server/services/application-auth';
import { StudentAccess } from '@/frontend/features/admin/users/student-access';
export default async function AccessPage(){if(!isFirebaseStaging())redirect('/home');if(!await getApplicationViewer())redirect('/sign-in');return <StudentAccess/>;}

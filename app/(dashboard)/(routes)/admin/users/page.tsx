import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { getDbUser } from '@/server/services/user';
import { AdminUsersView } from '@/frontend/features/admin/users/admin-users-view';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getApplicationViewer } from '@/server/services/application-auth';
import { SupabaseStudentAdmin } from '@/frontend/features/admin/users/supabase-student-admin';

const AdminUsersPage = async () => {
	if(isFirebaseStaging()){if(!await getApplicationViewer())redirect('/sign-in');return <SupabaseStudentAdmin/>;}
	const { userId } = await auth();

	if (!userId) {
		return redirect('/');
	}

	const dbUser = await getDbUser(userId);
	if (!dbUser || dbUser.role === 'STUDENT' || (dbUser.role as string) === 'student') {
		return redirect('/');
	}

	return <AdminUsersView />;
};

export default AdminUsersPage;

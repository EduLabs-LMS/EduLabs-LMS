import { isFirebaseStaging } from '@/shared/auth-config';
import { getWebsiteContext, courseCapability, offeringCapability } from '@/server/services/website';
import { WebsiteNavigationProvider } from '@/frontend/components/providers/application-auth-provider';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isTeacherSide, studentPreviewActive, studentPreviewCookie } from '@/shared/student-preview';
import { StudentPreviewBar } from '@/frontend/features/dashboard/student-preview';
import { auth } from '@clerk/nextjs/server';
import Sidebar from '@/frontend/components/sidebar';
import MobileSidebar from '@/frontend/features/dashboard/mobile-sidebar';
import Footer from '@/frontend/components/footer';
import SupportModal from '@/frontend/components/support-modal';
import WaitlistOverlay from '@/frontend/components/waitlist-overlay';
import { syncCurrentUser } from '@/server/services/user';

const DashboardLayout = async ({ children }: { children: React.ReactNode }) => {
	if (isFirebaseStaging()) {
        const context = await getWebsiteContext();
        if (!context) redirect('/sign-in');
        const courses = await context.repository.courses();
        const offerings = await context.repository.offerings(courses.map(c => c.id));
        const staffOrganizationIds = context.organizations.filter(o =>
          context.memberships.some(m => m.organization_id === o.id && m.status === 'active' && ['owner','admin'].includes(m.role)) ||
          courses.some(c => c.organization_id === o.id && (courseCapability(context,c) || offerings.some(f => f.course_id === c.id && offeringCapability(context,c,f.id))))
        ).map(o => o.id);
        const teacherSide = isTeacherSide(context.memberships, context.courseStaff, context.offeringStaff);
        const studentPreview = studentPreviewActive(teacherSide, (await cookies()).get(studentPreviewCookie)?.value);
        return <WebsiteNavigationProvider value={{ viewer: context.viewer, organizations: context.organizations.slice(0,100), staffOrganizationIds, teacherSide, studentPreview }}>
          <div data-lms-shell className="min-h-screen bg-slate-50 w-full relative">
            <MobileSidebar />
            <aside className="hidden md:block fixed start-4 top-4 bottom-4 w-64 z-50"><Sidebar /></aside>
            <main className="md:ps-72 pt-2 md:pt-4 min-h-screen bg-slate-50 flex flex-col justify-between">
              <div className={`flex-1 w-full p-4 sm:p-6 md:p-8${studentPreview ? ' pb-28' : ''}`}>{children}</div><Footer />
            </main>
            <StudentPreviewBar />
          </div>
        </WebsiteNavigationProvider>;
    }
	const { userId } = await auth();
	let initialIsApproved = true;
	let initialName: string | null = '';
	let userRole: string | null = null;
	let shouldShowWaitlist = false;

	if (userId) {
		const dbUser = await syncCurrentUser();
		if (dbUser) {
			userRole = dbUser.role;
			const isStudent =
			dbUser.role === 'STUDENT' || (dbUser.role as string) === 'student';
			initialIsApproved = dbUser.isApproved;
			initialName = dbUser.name;

			if (!dbUser.isApproved && isStudent) {
				shouldShowWaitlist = true;
			}
		} else {
			shouldShowWaitlist = true;
			initialIsApproved = false;
		}
	}

	return (
		<div data-lms-shell className="min-h-screen bg-slate-50 w-full relative">
		{/* Sticky Mobile Header & Drawer Trigger */}
		<MobileSidebar initialRole={userRole} />

		{/* Floating Desktop Sidebar */}
		<aside className="hidden md:block fixed start-4 top-4 bottom-4 w-64 z-50">
		<Sidebar initialRole={userRole} />
		</aside>

		{/* Main Content Canvas: Removed overflow-y-auto so native mobile window scroll works 100% */}
		<main className="md:ps-72 pt-2 md:pt-4 min-h-screen bg-slate-50 flex flex-col justify-between">
		<div className="flex-1 w-full p-4 sm:p-6 md:p-8">
		{children}
		</div>
		<Footer />
		</main>

		{/* Global Support Modal */}
		<SupportModal />

		{/* Waitlist Hard-Lock Overlay */}
		{userId && shouldShowWaitlist && (
			<WaitlistOverlay
			initialIsApproved={false}
			initialName={initialName}
			/>
		)}
		</div>
	);
};

export default DashboardLayout;

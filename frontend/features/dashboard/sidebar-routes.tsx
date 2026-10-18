// use client to avoid SSR error
'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import {
	BookOpen,
	CalendarClock,
	Home,
	LifeBuoy,
	LogOut,
	Users,
} from 'lucide-react';

import SupportModal from '@/frontend/components/support-modal';
import { cn } from '@/shared/utils';
import SidebarItem from '@/frontend/features/dashboard/sidebar-item';

type SidebarRoute = {
	icon: typeof Home;
	label: string;
	href?: string;
	badge?: string;
};

const studentRoutes: SidebarRoute[] = [
	{
		icon: Home,
		label: 'Home',
		href: '/home',
	},
	{
		icon: BookOpen,
		label: 'Self Learning',
		href: '/self-learning',
	},
	{ icon: Users, label: 'Sessions & Groups', href: '/sessions-groups' },
	{
		icon: BookOpen,
		label: 'Exams',
		href: '/exams',
	},
];

const SidebarRoutes = () => {
	const { signOut } = useClerk();
	const { user } = useUser();
	const isStaff =
		user?.publicMetadata?.role === 'teacher' ||
		user?.publicMetadata?.role === 'admin';

	const routes: SidebarRoute[] = isStaff
		? [
				{ icon: Home, label: 'Home', href: '/teacher/courses' },
				{ icon: BookOpen, label: 'Lessons', href: '/teacher/courses' },
			]
		: studentRoutes;

	const actionClassName =
		'flex min-h-11 w-full items-center gap-x-3 rounded-xl px-3 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950';

	return (
		<div className="flex h-full w-full flex-col gap-1">
			{routes.map((route) => {
				return (
					<SidebarItem
						badge={route.badge}
						key={route.label}
						icon={route.icon}
						label={route.label}
						href={route.href}
					/>
				);
			})}

			{!isStaff && (
				<SupportModal
					trigger={
						<button className={actionClassName} type="button">
							<LifeBuoy className="h-5 w-5 shrink-0 text-slate-500" />
							<span>Website Help</span>
						</button>
					}
				/>
			)}

			<div className="mt-auto border-t border-slate-100 pt-3">
				<button
					className={cn(actionClassName, 'text-rose-600 hover:bg-rose-50 hover:text-rose-700')}
					onClick={() => signOut(() => window.location.assign('/'))}
					type="button"
				>
					<LogOut className="h-5 w-5 shrink-0" />
					<span>Logout</span>
				</button>
			</div>
		</div>
	);
};

export default SidebarRoutes;

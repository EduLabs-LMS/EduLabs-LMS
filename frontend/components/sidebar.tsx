'use client';

import { L } from '@/frontend/components/language-provider';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton, useUser, useClerk } from '@/frontend/components/providers/v2-identity';
import { useWebsiteNavigation } from '@/frontend/components/providers/application-auth-provider';
import { isFirebaseStaging } from '@/shared/auth-config';
import { api } from '@/frontend/lib/api';
import {
	Home,
	BookOpen,
	Users,
	FileText,
	HelpCircle,
	LogOut,
	CheckSquare,
	Settings,
} from 'lucide-react';

import EduLabsMark from '@/frontend/components/edulabs-mark';
import { NotificationBell } from '@/frontend/features/notifications/notifications-view';
import { cn } from '@/shared/utils';
import { StudentPreviewToggle } from '@/frontend/features/dashboard/student-preview';

interface SidebarProps {
	className?: string;
	initialRole?: string | null;
	onNavigate?: () => void;
}

const Sidebar = ({ className, initialRole, onNavigate }: SidebarProps) => {
	const pathname = usePathname();
	const navigation = useWebsiteNavigation();
	const { user: clerkUser } = useUser();
	const { signOut } = useClerk();

	const [role, setRole] = useState<string | null>(
		initialRole ? initialRole.toLowerCase() : null
	);

	useEffect(() => {
		api
		.get('/api/user/status')
		.then((res) => {
			if (res.data?.user?.role) {
				setRole(res.data.user.role.toLowerCase());
			}
		})
		.catch(() => {});
	}, []);

	const isAdminOrTeacher = isFirebaseStaging() ? !!navigation?.staffOrganizationIds.length : role === 'admin' || role === 'teacher';

	const studentPreview = !!navigation?.teacherSide && !!navigation?.studentPreview;

	const isHomeActive = pathname === '/' || pathname === '/home';
	// Teacher-side users manage courses inside Self-learning, including the teacher-only pages (create, programs, website).
	const isSelfLearningActive =
	pathname === '/self-learning' ||
	pathname.startsWith('/self-learning') ||
	pathname.startsWith('/courses') ||
	(isAdminOrTeacher && pathname.startsWith('/teacher'));
	const isGroupActive =
	pathname === '/sessions-groups' || pathname === '/sessions' || pathname === '/group' ||
	pathname === '/groups' ||
	pathname.startsWith('/group');
	const isSettingsActive = pathname === '/settings' || pathname.startsWith('/settings/') || pathname === '/personalization';
	const isExamsActive = pathname.startsWith('/exams');
	const isSupportActive = pathname.startsWith('/support');
	const isAdminUsersActive = pathname.startsWith('/admin/users');
	const isAdminSubmissionsActive = pathname.startsWith('/admin/submissions');

	const displayName =
	clerkUser?.fullName ||
	clerkUser?.username ||
	[clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
	'Student User';

	return (
		<aside
		className={cn(
			'h-full w-full bg-white rounded-[28px] border-[2.5px] border-black shadow-hard flex flex-col justify-between overflow-hidden select-none',
			className
		)}
		>
		<div className="flex flex-col flex-1 min-h-0">
		{/* 1. TOP BRANDING HEADER */}
		<div className="p-4 border-b-[2.5px] border-black flex items-center gap-3 bg-white text-black shrink-0">
		<EduLabsMark className="h-10 w-10 shrink-0" />
		<div className="flex flex-col min-w-0">
		<span className="font-display text-2xl font-normal leading-none text-black truncate">
		EduLabs
		</span>
		<span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-600"><L id="navigation.learning_platform"/></span>
		</div>
		</div>

		{/* 2. TACTILE NAVIGATION LINKS */}
		<div className="p-3 flex flex-col space-y-1.5 overflow-y-auto scrollbar-none flex-1">
		<StudentPreviewToggle onNavigate={onNavigate} />
		<Link
		href="/home"
		onClick={() => onNavigate?.()}
		className={cn(
			'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',
			isHomeActive
			? 'bg-primary text-black border-black font-semibold shadow-hard-sm'
			: 'text-slate-700 hover:text-black hover:bg-slate-100'
		)}
		>
		<Home
		className={cn(
			'w-[22px] h-[22px] shrink-0 transition-colors',
			isHomeActive ? 'text-black' : 'text-slate-500'
		)}
		/>
		<span><L id="navigation.home"/></span>
		</Link>

		<Link
		href="/self-learning"
		onClick={() => onNavigate?.()}
		className={cn(
			'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',
			isSelfLearningActive
			? 'bg-primary text-black border-black font-semibold shadow-hard-sm'
			: 'text-slate-700 hover:text-black hover:bg-slate-100'
		)}
		>
		<BookOpen
		className={cn(
			'w-[22px] h-[22px] shrink-0 transition-colors',
			isSelfLearningActive ? 'text-black' : 'text-slate-500'
		)}
		/>
		<span><L id="navigation.self_learning"/></span>
		</Link>

		{isAdminOrTeacher && !studentPreview && (<Link
			href="/admin/users"
			onClick={() => onNavigate?.()}
			className={cn(
				'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',
				 isAdminUsersActive
				 ? 'bg-primary text-black border-black font-semibold shadow-hard-sm'
				 : 'text-slate-700 hover:text-black hover:bg-slate-100'
			)}
			>
			<Users
			className={cn(
				'w-[22px] h-[22px] shrink-0',
				 isAdminUsersActive ? 'text-black' : 'text-slate-500'
			)}
			/>
			<span><L id="navigation.users_groups"/></span>
			</Link>)}

		{!studentPreview && (
		<Link
		href="/sessions-groups"
		onClick={() => onNavigate?.()}
		className={cn(
			'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',
			isGroupActive
			? 'bg-primary text-black border-black font-semibold shadow-hard-sm'
			: 'text-slate-700 hover:text-black hover:bg-slate-100'
		)}
		>
		<Users
		className={cn(
			'w-[22px] h-[22px] shrink-0 transition-colors',
			isGroupActive ? 'text-black' : 'text-slate-500'
		)}
		/>
		<span><L id="navigation.sessions_groups"/></span>
		</Link>
		)}

		{isAdminOrTeacher && !studentPreview && (<Link
			href="/admin/submissions"
			onClick={() => onNavigate?.()}
			className={cn(
				'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',
				 isAdminSubmissionsActive
				 ? 'bg-primary text-black border-black font-semibold shadow-hard-sm'
				 : 'text-slate-700 hover:text-black hover:bg-slate-100'
			)}
			>
			<CheckSquare
			className={cn(
				'w-[22px] h-[22px] shrink-0',
				 isAdminSubmissionsActive ? 'text-black' : 'text-slate-500'
			)}
			/>
			<span><L id="navigation.homework_queue"/></span>
			</Link>)}

		{!studentPreview && (
		<Link
		href="/exams"
		onClick={() => onNavigate?.()}
		className={cn(
			'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',
			isExamsActive
			? 'bg-primary text-black border-black font-semibold shadow-hard-sm'
			: 'text-slate-700 hover:text-black hover:bg-slate-100'
		)}
		>
		<FileText
		className={cn(
			'w-[22px] h-[22px] shrink-0 transition-colors',
			isExamsActive ? 'text-black' : 'text-slate-500'
		)}
		/>
		<span><L id="navigation.exams"/></span>
		</Link>
		)}

		<a role="link"
		href="/support"
        tabIndex={0}
		onClick={() => onNavigate?.()}
		className={cn(
			'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',
			isSupportActive
			? 'bg-primary text-black border-black font-semibold shadow-hard-sm'
			: 'text-slate-700 hover:text-black hover:bg-slate-100'
		)}
		>
		<HelpCircle
		className={cn(
			'w-[22px] h-[22px] shrink-0 transition-colors',
			isSupportActive ? 'text-black' : 'text-slate-500'
		)}
		/>
		<span><L id="navigation.support"/></span>
		</a>

		<Link href="/settings" onClick={() => onNavigate?.()} aria-current={isSettingsActive?'page':undefined} className={cn('relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out cursor-pointer active:translate-x-0.5 active:translate-y-0.5',isSettingsActive?'bg-primary text-black border-black font-semibold shadow-hard-sm':'text-slate-700 hover:text-black hover:bg-slate-100')}><Settings aria-hidden className={cn('w-[22px] h-[22px] shrink-0',isSettingsActive?'text-black':'text-slate-500')}/><span><L id="navigation.settings"/></span></Link>

		</div>
		</div>

		{/* 3. BOTTOM FOOTER WITH USER PROFILE & LOGOUT */}
		<div className="p-3 border-t-[2.5px] border-black bg-slate-50 shrink-0 space-y-2">
		<div className="flex items-center gap-3 p-2 rounded-2xl bg-white border-2 border-black shadow-hard-sm">
		{/* z-[99999] and pointer-events-auto fixes Clerk popover touch lock inside Radix Sheet */}
		<UserButton
		appearance={{
			elements: {
				avatarBox: 'h-9 w-9 border-2 border-black shadow-hard-sm',
		 userButtonPopoverCard: 'shadow-hard rounded-2xl border-2 border-black z-[99999] pointer-events-auto',
		 userButtonPopoverMain: 'z-[99999] pointer-events-auto',
			},
		}}
		/>
		<div className="flex flex-col min-w-0 flex-1">
		<span className="text-xs font-bold text-slate-900 truncate leading-tight">
		<bdi dir="auto">{displayName}</bdi>
		</span>
		<div className="flex items-center gap-1.5 mt-0.5">
		<span
		className={cn(
			'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase leading-none border',
			role === 'admin'
			? 'bg-rose-50 text-rose-700 border-rose-200'
			: role === 'teacher'
			? 'bg-amber-50 text-amber-700 border-amber-200'
			: 'bg-primary text-black border-black'
		)}
		>
		<L text={isFirebaseStaging() ? (isAdminOrTeacher ? 'STAFF' : 'STUDENT') : role ? role.toUpperCase() : 'STUDENT'}/>
		</span>
		</div>
		</div>
		{isFirebaseStaging() && <NotificationBell onNavigate={onNavigate} />}
		</div>

		<button
		type="button"
		onClick={() => {
			onNavigate?.();
			signOut(() => window.location.assign('/'));
		}}
		className="flex items-center gap-3 px-3 py-2.5 text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all duration-150 w-full text-left cursor-pointer active:scale-[0.97]"
		>
		<LogOut className="w-4 h-4 shrink-0 text-slate-500" />
		<span><L id="navigation.sign_out"/></span>
		</button>
		</div>
		</aside>
	);
};

export default Sidebar;

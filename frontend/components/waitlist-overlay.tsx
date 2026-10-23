'use client';

import { useEffect, useState } from 'react';
import { useClerk, useUser } from '@/frontend/components/providers/v2-identity';
import { api } from '@/frontend/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
	Clock,
	MessageCircle,
	LogOut,
	ShieldAlert,
	UserCheck,
	Settings,
	ExternalLink,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

interface WaitlistOverlayProps {
	initialIsApproved?: boolean;
	initialName?: string | null;
}

export const WaitlistOverlay = ({
	initialIsApproved = false,
}: WaitlistOverlayProps) => {
	const { user: clerkUser } = useUser();
	const { signOut, openUserProfile } = useClerk();
	const router = useRouter();

	const [isApproved, setIsApproved] = useState<boolean>(initialIsApproved);

	// Sync initial user details when Clerk or API loads
	useEffect(() => {
		const checkInitialStatus = async () => {
			try {
				const res = await api.get('/api/user/status');
				if (res.data?.authenticated && res.data?.user) {
					const userData = res.data.user;
					const isStudent = userData.role?.toLowerCase() === 'student';
					const userIsApproved = userData.isApproved || !isStudent;
					setIsApproved(Boolean(userIsApproved));
				}
			} catch (err) {
				console.error('[WAITLIST_STATUS_CHECK_ERROR]', err);
			}
		};

		checkInitialStatus();
	}, [clerkUser]);

	// Lock body scroll while overlay is active and unapproved
	useEffect(() => {
		if (!isApproved) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}

		return () => {
			document.body.style.overflow = '';
		};
	}, [isApproved]);

	// Auto-polling for approval every 5 seconds
	useEffect(() => {
		if (isApproved) return;

		const interval = setInterval(async () => {
			try {
				const res = await api.get('/api/user/status');
				if (res.data?.authenticated && res.data?.user) {
					const userData = res.data.user;
					const isStudent = userData.role?.toLowerCase() === 'student';
					const userIsApproved = userData.isApproved || !isStudent;
					if (userIsApproved) {
						setIsApproved(true);
						toast.success(
							'Your account has been approved! Welcome to EduLabs.',
							{
								duration: 6000,
								icon: '🎉',
							}
						);
						router.refresh();
					}
				}
			} catch (error) {
				// Silently retry next interval
			}
		}, 5000);

		return () => clearInterval(interval);
	}, [isApproved, router]);

	const studentName =
		clerkUser?.fullName ||
		[clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
		clerkUser?.username ||
		'Student Applicant';

	const studentEmail =
		clerkUser?.primaryEmailAddress?.emailAddress || '';

	return (
		<AnimatePresence mode="wait">
			{!isApproved && (
				<motion.div
					key="waitlist-backdrop"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.25, ease: 'easeInOut' }}
					className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto select-none pointer-events-auto"
				>
					<motion.div
						key="waitlist-card"
						initial={{ opacity: 0, scale: 0.98 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.98 }}
						transition={{ duration: 0.25, ease: isApproved ? 'easeIn' : 'easeOut' }}
						className="w-full max-w-lg rounded-2xl bg-white p-6 sm:p-8 shadow-2xl border-2 border-black text-slate-900 relative overflow-hidden"
					>
						{/* Top Status Header */}
						<div className="text-center space-y-2">
							<div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-green-50 border border-cyan-200 text-green-800 shadow-inner">
								<Clock className="h-7 w-7 animate-pulse text-green-800" />
							</div>
							<div className="inline-flex items-center gap-1.5 rounded-full bg-cyan-100/80 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cyan-900">
								<ShieldAlert className="h-3.5 w-3.5" />
								Account Pending Approval
							</div>
							<h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
								Account Pending Approval
							</h2>
							<p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
								Your account is registered! Please ensure your name in your profile matches Mrs. Ghada&apos;s official enrollment list.
							</p>
						</div>

						<div className="my-6 border-t border-slate-100" />

						{/* CLERK PROFILE BOX */}
						<div className="rounded-xl border-2 border-black bg-slate-50/70 p-4 space-y-3">
							<div className="flex items-center justify-between">
								<span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
									<UserCheck className="h-3.5 w-3.5 text-green-800" />
									Current Profile Credentials
								</span>
								<span className="text-[11px] font-medium text-slate-400">
									Verified via Clerk
								</span>
							</div>

							<div className="flex items-center gap-3.5 bg-white p-3 rounded-xl border-2 border-black/80 shadow-2xs">
								{clerkUser?.imageUrl ? (
									<img
										src={clerkUser.imageUrl}
										alt="Student Avatar"
										className="h-12 w-12 rounded-full border-2 border-black object-cover shrink-0"
									/>
								) : (
									<div className="grid h-12 w-12 place-items-center rounded-full bg-cyan-100 text-cyan-700 font-bold text-base shrink-0">
										{studentName.charAt(0)}
									</div>
								)}
								<div className="min-w-0 flex-1 space-y-0.5">
									<p className="text-sm font-bold text-slate-900 truncate">
										{studentName}
									</p>
									<p className="text-xs text-slate-500 font-mono truncate">
										{studentEmail}
									</p>
								</div>
							</div>

							<button
								type="button"
								onClick={() => openUserProfile()}
								className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-black bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold shadow-2xs transition cursor-pointer"
							>
								<Settings className="h-4 w-4 text-slate-500" />
								<span>Manage Profile (Update Real Name)</span>
								<ExternalLink className="h-3 w-3 text-slate-400 ml-auto" />
							</button>
						</div>

						{/* DIRECT WHATSAPP ACTION */}
						<div className="mt-4 space-y-2">
							<a
								href="https://wa.me/201156102015"
								target="_blank"
								rel="noopener noreferrer"
								className="w-full min-h-[44px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-sm shadow-md shadow-emerald-600/20 transition cursor-pointer"
							>
								<MessageCircle className="h-5 w-5 fill-current shrink-0" />
								<span>Contact Assistant on WhatsApp for Admission</span>
							</a>
							<p className="text-center font-mono text-xs text-slate-500 font-medium">
								+20 115 610 2015
							</p>
						</div>

						{/* Auto-Polling Live Status Indicator */}
						<div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
								<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
							</span>
							<span>Checking approval status in real-time (auto-refreshes every 5s)</span>
						</div>

						{/* Sign Out Option */}
						<div className="mt-5 pt-4 border-t border-slate-100 flex justify-center">
							<button
								type="button"
								onClick={() => signOut(() => router.push('/sign-in'))}
								className="min-h-[44px] inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium transition cursor-pointer px-3"
							>
								<LogOut className="h-3.5 w-3.5" />
								<span>Sign out or switch account</span>
							</button>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
};

export default WaitlistOverlay;

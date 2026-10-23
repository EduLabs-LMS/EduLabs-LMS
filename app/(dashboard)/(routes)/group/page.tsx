import { isFirebaseStaging } from '@/shared/auth-config';
import { WebsiteGroups, type WebsiteSearch } from '../../_components/website-pages';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Users, MessageCircle } from 'lucide-react';

import { getGroupMembership, getGroupPeers } from '@/server/queries/groups';
import { getUpcomingGroupSessions } from '@/shared/group-schedule';
import { isTeacher } from '@/server/services/teacher';
import { getDbUser } from '@/server/services/user';
import GroupRosterView from '@/frontend/features/groups/group-roster-view';



const GroupPage = async ({ searchParams }: { searchParams: Promise<WebsiteSearch> }) => {
	if (isFirebaseStaging()) return <WebsiteGroups search={await searchParams} />;
	const { userId, sessionClaims } = await auth();

	if (!userId) {
		return redirect('/');
	}

	const isStaff = await isTeacher(userId, sessionClaims);
	if (isStaff) {
		return redirect('/home');
	}

	const dbUser = await getDbUser(userId);
	const targetUserId = dbUser ? dbUser.id : userId;

	const membership = await getGroupMembership(userId, dbUser?.id);

	if (!membership || !membership.group) {
		return (
			<div className="mx-auto max-w-3xl px-4 py-12 animate-in fade-in-50 duration-200">
				<div className="rounded-3xl border-2 border-black bg-white p-8 sm:p-10 shadow-hard-sm text-center space-y-4">
					<div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-green-50 border border-cyan-200 text-cyan-700">
						<Users className="h-8 w-8" />
					</div>
					<div className="space-y-1">
						<h1 className="text-2xl font-bold text-slate-950">
							No Study Group Assigned Yet
						</h1>
						<p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
							You have registered successfully, but Mrs. Ghada has not assigned you to an active study group cohort yet.
						</p>
					</div>

					<div className="pt-4 flex justify-center">
						<a
							href="https://wa.me/201156102015"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary hover:bg-primary/90 text-black border-2 border-black font-semibold text-sm shadow-hard-sm shadow-emerald-600/20 transition cursor-pointer"
						>
							<MessageCircle className="h-4 w-4 fill-current" />
							<span>Contact Assistant on WhatsApp (+20 115 610 2015)</span>
						</a>
					</div>
				</div>
			</div>
		);
	}

	// 1. Fetch upcoming session for this group
	const upcomingSessions = getUpcomingGroupSessions(
		membership.group.name,
		membership.group.schedule
	);
	const nextSession = upcomingSessions[0]
		? {
				date: upcomingSessions[0].date.toISOString(),
				dayLabel: upcomingSessions[0].dayLabel,
				timeLabel: upcomingSessions[0].timeLabel,
				fullFormatted: upcomingSessions[0].fullFormatted,
		  }
		: null;

	// 2. Fetch all enrolled peers in the same study group
	const peers = await getGroupPeers(membership.groupId, targetUserId, userId);

	return (
		<GroupRosterView
			groupName={membership.group.name}
			nextSession={nextSession}
			peers={peers}
		/>
	);
};

export default GroupPage;

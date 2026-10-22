export interface StudentLesson {
	href?: string | null;
	groupKey?: string;
	partsCount?: number | null;
	status?: "Completed" | "In Progress" | "Open Lesson" | "Not Started" | "Locked";
	id: string;
	title: string;
	description?: string | null;
	imageUrl?: string | null;
	chapterType?: string;
	chapterNumber: number | null;
	chapters: {
		id: string;
		title: string;
		isCompleted: boolean;
	}[];
}

export interface SelfLearningLesson {
	href?: string | null;
	status?: "Completed" | "In Progress" | "Open Lesson" | "Not Started" | "Locked";
	partsCount?: number | null;
	id: string;
	title: string;
	description?: string | null;
	imageUrl?: string | null;
	chapterType?: string;
	chapterNumber: number | null;
	chapters: {
		id: string;
		title: string;
		isCompleted: boolean;
	}[];
}

export interface SelfLearningChapter {
	progressAvailable?: boolean;
	progressUnavailable?: boolean;
	id?: string;
	/** Prefix such as "Chapter" or "Month". */
	type?: string;
	number: number;
	/** The chapter's own name, e.g. "Ohm's Law". */
	title: string;
	/** Quick short summary. */
	subtitle: string;
	/** Optional full description. */
	description: string;
	lessonCount: number;
	lessons: SelfLearningLesson[];
}

export interface PeerMember {
	enrollmentStatus?: string;
	id: string;
	name: string;
	email: string;
	role: string;
	isCurrentUser: boolean;
	latestSubmission: {
		id: string;
		status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
		createdAt: string;
		chapterTitle: string;
		courseTitle?: string;
		timeAgo: string;
	} | null;
}

export interface GroupRosterViewProps {
 streamLabel?:string;
 streamIcon?:'video'|'radio'|'users'|'presentation'|'headphones'|'messages';
 serverNow?: string;
 privacySafe?: boolean;
 mode?: 'online' | 'center';
 location?: string;
	phase1?: boolean;
	groupName: string;
	nextSession: {
		date: string;
		dayLabel: string;
		timeLabel: string;
		fullFormatted: string;
  endDate?: string;
	} | null;
	peers: PeerMember[];
}

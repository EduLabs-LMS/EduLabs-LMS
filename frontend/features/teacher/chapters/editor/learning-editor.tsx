'use client';
import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';
import { CurriculumPanel } from '@/frontend/features/teacher/chapters/curriculum-panel';
import { SegmentEditor } from '@/frontend/features/teacher/chapters/segment-editor';
import type { LearningSegment, LearningTree } from '@/shared/contracts/lessons';

/** The course curriculum (chapters, lessons, status). See curriculum-panel.tsx. */
export function LearningTreeEditor({ courseId, tree }: { courseId: string; tree: LearningTree }) {
	const courseBase = useCourseManagementPath();
	return <CurriculumPanel courseId={courseId} tree={tree} courseBase={courseBase} />;
}

/** The segment editor page body. See segment-editor.tsx. */
export function LearningPartEditor({ courseId, segment, tree, thumbnailUrl }: { courseId: string; segment: LearningSegment; tree: LearningTree; thumbnailUrl?: string | null }) {
	return <SegmentEditor courseId={courseId} segment={segment} tree={tree} thumbnailUrl={thumbnailUrl} />;
}

import 'server-only';
import { continuePart, lessonPartHref, lessonPlayback, type SegmentProgress } from '@/shared/contracts/lessons';
import { lessonBlockViews } from '@/server/services/lesson-blocks';
import type { learningService } from '@/server/services/lessons';

type Service = Pick<Awaited<ReturnType<typeof learningService>>, 'offering' | 'outline' | 'lesson' | 'progress' | 'thumbnails' | 'media'>;

/**
 * What a student's lesson part page shows (fix track 2a, A0-01 and A2a-01): the course outline for the chapter number, the part list and
 * previous/next, and the content of the OPENED lesson only. The group and enrollment check runs first, as before. The result is the
 * LessonTabs props and the homework section's ids, so the page renders it and scripts/my-scope-proof.cjs compares it with the old page.
 */
export async function studentLessonPage(service: Service, courseId: string, segmentId: string, offeringId: string) {
  await service.offering(offeringId);
  const [outline, progress] = await Promise.all([service.outline(), service.progress(offeringId)]);
  const found = outline.segments.find(s => s.id === segmentId);
  if (!found) return { kind: 'unavailable' as const };
  const lesson = outline.lessons.find(l => l.id === found.lesson_id)!;
  const courseModule = outline.modules.find(m => m.id === lesson.module_id)!;
  const content = await service.lesson(outline, lesson.id, segmentId);
  const segment = content.parts.find(s => s.id === segmentId);
  if (!segment) return { kind: 'unavailable' as const };
  const parts = content.parts.slice().sort((a, b) => a.position - b.position);
  const state = progress.find((p: SegmentProgress) => p.segment_id === segment.id);
  const thumbnails = await service.thumbnails(parts.flatMap(s => s.thumbnail_asset_id ? [s.thumbnail_asset_id] : []));
  const moduleIndex = (id: string) => outline.modules.findIndex(m => m.id === id);
  const ordered = outline.lessons.filter(l => outline.segments.some(s => s.lesson_id === l.id)).sort((a, b) => moduleIndex(a.module_id) - moduleIndex(b.module_id) || a.position - b.position);
  const index = ordered.findIndex(l => l.id === lesson.id);
  const adjacent = (offset: number) => {
    const l = ordered[index + offset]; if (!l) return undefined;
    const part = continuePart(outline.segments.filter(s => s.lesson_id === l.id), progress, offeringId);
    return part ? { title: l.title, href: lessonPartHref(courseId, part.id, offeringId) } : undefined;
  };
  let videoUrl = segment.video_asset_id ? await service.media(segment.video_asset_id) : segment.video_url;
  const attachments = content.resources.filter(r => r.segment_id === segmentId).map(r => ({ id: r.id, name: r.name, url: `/api/learning/${courseId}/resources/${r.id}` }));
  const blocks = await lessonBlockViews(content, lesson.id, courseId, service.media);
  const blockVideo = !videoUrl ? blocks.find(b => ['video', 'embed'].includes(b.type) && lessonPlayback(b.mediaUrl)) : undefined;
  if (blockVideo) videoUrl = blockVideo.mediaUrl;
  const videoAssetId = segment.video_asset_id ?? (blockVideo ? content.blocks.find(b => b.id === blockVideo.id)?.media_asset_id : null) ?? null;
  return {
    kind: 'page' as const,
    key: `${segment.id}:${state?.revision ?? 0}`,
    tabs: {
      courseId, chapterId: segment.id, title: segment.title,
      chapterNumber: moduleIndex(courseModule.id) + 1, chapterType: courseModule.group_type, courseTitle: lesson.title, description: segment.description,
      previousLesson: adjacent(-1), nextLesson: adjacent(1),
      lessonBlocks: blocks.filter(b => b.id !== blockVideo?.id),
      playbackId: null, videoUrl, solutionVideoUrl: null, contentType: 'VIDEO_EXPLANATION' as const, completeOnEnd: false, isCompleted: state?.status === 'completed',
      isWatched: state?.status === 'completed', userId: '', hasSubmission: false, attachments,
      secure: { offeringId, revision: state?.revision ?? 0, position: state?.video_position_seconds ?? 0, assetId: videoAssetId, thumbnailUrl: segment.thumbnail_asset_id ? thumbnails[segment.thumbnail_asset_id] : null, status: state?.status ?? 'not_started' },
      segments: parts.map(s => ({ ...s, thumbnailUrl: s.thumbnail_asset_id ? thumbnails[s.thumbnail_asset_id] : null, contentType: 'VIDEO_EXPLANATION' as const, isCompleted: progress.some(p => p.segment_id === s.id && p.status === 'completed') })),
    },
    homework: { courseId, lessonId: lesson.id, segmentId: segment.id, offeringId },
  };
}

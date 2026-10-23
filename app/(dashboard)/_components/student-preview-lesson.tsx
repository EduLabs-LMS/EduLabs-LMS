import Link from 'next/link';
import { notFound,redirect } from 'next/navigation';
import { learningService } from '@/server/services/lessons';
import { getApplicationViewer } from '@/server/services/application-auth';
import LessonTabs from '@/frontend/features/courses/lesson/lesson-tabs';
import { L } from '@/frontend/components/language-provider';
import { lessonId,continuePart,lessonPartHref,lessonPlayback } from '@/shared/contracts/lessons';
import { lessonBlockViews } from '@/server/services/lesson-blocks';

/**
 * Display-only student preview of a lesson part for teacher-side users.
 * Same player and layout a student gets, but it never reads or writes enrollment progress:
 * the player runs in preview mode (no progress saves) and homework/answers are not rendered.
 * Only published content is shown, exactly like the student lesson page.
 */
export async function StudentPreviewLessonPage({courseId,segmentId,offeringId}:{courseId:string;segmentId:string;offeringId?:string}) {
 if(!await getApplicationViewer())redirect('/sign-in');
 if(!lessonId.safeParse(courseId).success||!lessonId.safeParse(segmentId).success)notFound();
 const offering=lessonId.safeParse(offeringId).success?offeringId!:'';
 try {
 const service=await learningService(courseId);
 if(service.course.status!=='published')return <UnavailablePreview/>;
 const tree=await service.tree();
 const segment=tree.segments.find(s=>s.id===segmentId);if(!segment)return <UnavailablePreview/>;
 const lesson=tree.lessons.find(l=>l.id===segment.lesson_id)!;
 const courseModule=tree.modules.find(m=>m.id===lesson.module_id)!;
 const parts=tree.segments.filter(s=>s.lesson_id===lesson.id).sort((a,b)=>a.position-b.position);
 const thumbnails=await service.thumbnails(parts.flatMap(s=>s.thumbnail_asset_id?[s.thumbnail_asset_id]:[]));
 const ordered=tree.lessons.filter(l=>tree.segments.some(s=>s.lesson_id===l.id)).sort((a,b)=>tree.modules.findIndex(m=>m.id===a.module_id)-tree.modules.findIndex(m=>m.id===b.module_id)||a.position-b.position);
 const index=ordered.findIndex(l=>l.id===lesson.id);
 const adjacent=(delta:number)=>{const l=ordered[index+delta];if(!l)return undefined;const part=continuePart(tree.segments.filter(s=>s.lesson_id===l.id),[],offering);return part?{title:l.title,href:lessonPartHref(courseId,part.id,offering)}:undefined;};
 let videoUrl=segment.video_asset_id?await service.media(segment.video_asset_id):segment.video_url;
 const attachments=tree.resources.filter(r=>r.segment_id===segmentId).map(r=>({id:r.id,name:r.name,url:`/api/learning/${courseId}/resources/${r.id}`}));
 const blocks=await lessonBlockViews(tree,lesson.id,courseId,service.media);
 const blockVideo=!videoUrl?blocks.find(b=>['video','embed'].includes(b.type)&&lessonPlayback(b.mediaUrl)):undefined;
 if(blockVideo)videoUrl=blockVideo.mediaUrl;
 const videoAssetId=segment.video_asset_id??(blockVideo?tree.blocks.find(b=>b.id===blockVideo.id)?.media_asset_id:null)??null;
 return <div className="mx-auto max-w-7xl space-y-4"><LessonTabs courseId={courseId} chapterId={segment.id} title={segment.title}
  chapterNumber={tree.modules.indexOf(courseModule)+1} chapterType={courseModule.group_type} courseTitle={lesson.title} description={segment.description}
  previousLesson={adjacent(-1)} nextLesson={adjacent(1)} lessonBlocks={blocks.filter(b=>b.id!==blockVideo?.id)}
  playbackId={null} videoUrl={videoUrl} solutionVideoUrl={null} contentType="VIDEO_EXPLANATION" completeOnEnd={false} isCompleted={false} isWatched={false} userId="" hasSubmission={false} attachments={attachments}
  secure={{offeringId:offering,revision:0,position:0,assetId:videoAssetId,thumbnailUrl:segment.thumbnail_asset_id?thumbnails[segment.thumbnail_asset_id]:null,status:'preview',preview:true}}
  segments={parts.map(s=>({...s,thumbnailUrl:s.thumbnail_asset_id?thumbnails[s.thumbnail_asset_id]:null,contentType:'VIDEO_EXPLANATION',isCompleted:false}))}/>
  <p role="note" className="rounded-2xl border-2 border-black bg-card p-4 text-sm shadow-hard-sm"><L id="preview.homework_note"/></p></div>;
 }catch(e){return <UnavailablePreview failed={(e as {status?:number}).status===503}/>;}
}
function UnavailablePreview({failed=false}:{failed?:boolean}) {return <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3"><p role="alert">{failed?'Lessons could not be loaded. Please retry.':'This lesson is unpublished or unavailable, so students cannot see it.'}</p><Link className="text-sky-700 font-semibold underline" href="/self-learning">Back to Self-learning</Link></div>;}

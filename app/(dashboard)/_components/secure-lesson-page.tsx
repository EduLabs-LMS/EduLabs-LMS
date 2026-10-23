import Link from 'next/link';
import { notFound,redirect } from 'next/navigation';
import { learningService } from '@/server/services/lessons';
import { getApplicationViewer } from '@/server/services/application-auth';
import LessonTabs from '@/frontend/features/courses/lesson/lesson-tabs';
import { lessonId,continuePart,lessonPartHref,lessonPlayback } from '@/shared/contracts/lessons';
import { lessonBlockViews } from '@/server/services/lesson-blocks';
import { HomeworkAssignments } from '@/frontend/features/courses/lesson/homework-assignments';

export async function SecureLessonPage({courseId,segmentId,offeringId}:{courseId:string;segmentId:string;offeringId?:string}) {
 if(!await getApplicationViewer())redirect('/sign-in');
 if(!lessonId.safeParse(courseId).success||!lessonId.safeParse(segmentId).success||!lessonId.safeParse(offeringId).success)notFound();
 return <LessonContent courseId={courseId} segmentId={segmentId} offeringId={offeringId!}/>;
}
async function LessonContent({courseId,segmentId,offeringId}:{courseId:string;segmentId:string;offeringId:string}) {
 try {
 const service=await learningService(courseId);
 await service.offering(offeringId!);
 const [tree,progress]=await Promise.all([service.tree(),service.progress(offeringId!)]);
 const segment=tree.segments.find(s=>s.id===segmentId);if(!segment)return <UnavailableLesson/>;
 const lesson=tree.lessons.find(l=>l.id===segment.lesson_id)!;
 const courseModule=tree.modules.find(m=>m.id===lesson.module_id)!;
 const parts=tree.segments.filter(s=>s.lesson_id===lesson.id).sort((a,b)=>a.position-b.position);
 const state=progress.find(p=>p.segment_id===segment.id);
 const thumbnails=await service.thumbnails(parts.flatMap(s=>s.thumbnail_asset_id?[s.thumbnail_asset_id]:[]));
 const ordered=tree.lessons.filter(l=>tree.segments.some(s=>s.lesson_id===l.id)).sort((a,b)=>tree.modules.findIndex(m=>m.id===a.module_id)-tree.modules.findIndex(m=>m.id===b.module_id)||a.position-b.position);
 const index=ordered.findIndex(l=>l.id===lesson.id);
 const adjacent=(offset:number)=>{const l=ordered[index+offset];if(!l)return undefined;const part=continuePart(tree.segments.filter(s=>s.lesson_id===l.id),progress,offeringId);return part?{title:l.title,href:lessonPartHref(courseId,part.id,offeringId)}:undefined;};
 let videoUrl=segment.video_asset_id?await service.media(segment.video_asset_id):segment.video_url;
 const attachments=await Promise.all(tree.resources.filter(r=>r.segment_id===segmentId).map(async r=>({id:r.id,name:r.name,url:`/api/learning/${courseId}/resources/${r.id}`})));
 const blocks=await lessonBlockViews(tree,lesson.id,courseId,service.media);
 const blockVideo=!videoUrl?blocks.find(b=>['video','embed'].includes(b.type)&&lessonPlayback(b.mediaUrl)):undefined;
 if(blockVideo)videoUrl=blockVideo.mediaUrl;
 const videoAssetId=segment.video_asset_id??(blockVideo?tree.blocks.find(b=>b.id===blockVideo.id)?.media_asset_id:null)??null;
 return <div className="mx-auto max-w-7xl"><LessonTabs key={`${segment.id}:${state?.revision??0}`} courseId={courseId} chapterId={segment.id} title={segment.title}
  chapterNumber={tree.modules.indexOf(courseModule)+1} chapterType={courseModule.group_type} courseTitle={lesson.title} description={segment.description}
  previousLesson={adjacent(-1)} nextLesson={adjacent(1)}
  lessonBlocks={blocks.filter(b=>b.id!==blockVideo?.id)}
  playbackId={null} videoUrl={videoUrl} solutionVideoUrl={null} contentType="VIDEO_EXPLANATION" completeOnEnd={false} isCompleted={state?.status==='completed'}
  isWatched={state?.status==='completed'} userId="" hasSubmission={false} attachments={attachments}
  secure={{offeringId:offeringId!,revision:state?.revision??0,position:state?.video_position_seconds??0,assetId:videoAssetId,thumbnailUrl:segment.thumbnail_asset_id?thumbnails[segment.thumbnail_asset_id]:null,status:state?.status??'not_started'}}
  segments={parts.map(s=>({...s,thumbnailUrl:s.thumbnail_asset_id?thumbnails[s.thumbnail_asset_id]:null,contentType:'VIDEO_EXPLANATION',isCompleted:progress.some(p=>p.segment_id===s.id&&p.status==='completed')}))}/><HomeworkAssignments key={`hw:${segment.id}`} courseId={courseId} lessonId={lesson.id} segmentId={segment.id} offeringId={offeringId}/></div>;
 }catch(e){return <UnavailableLesson failed={(e as {status?:number}).status===503}/>;}
}
function UnavailableLesson({failed=false}:{failed?:boolean}) {return <div className="rounded-2xl border-2 border-black bg-white p-6 space-y-3"><p role="alert">{failed?'Lessons could not be loaded. Please retry.':'This lesson is unpublished, unavailable or your enrollment has expired.'}</p><Link className="text-green-900 font-semibold" href="/self-learning">Return to your lessons</Link></div>;}

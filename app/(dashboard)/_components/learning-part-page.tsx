import { notFound,redirect } from 'next/navigation';
import { getApplicationViewer } from '@/server/services/application-auth';
import { learningService } from '@/server/services/lessons';
import { lessonId,lessonPlayback } from '@/shared/contracts/lessons';
import { LearningPartEditor } from '@/frontend/features/teacher/chapters/editor/learning-editor';
import LessonTabs from '@/frontend/features/courses/lesson/lesson-tabs';
import Link from 'next/link';
import Banner from '@/frontend/components/banner';
import { lessonBlockViews } from '@/server/services/lesson-blocks';
export async function LearningPartPage({courseId,segmentId,preview=false}:{courseId:string;segmentId:string;preview?:boolean}) {
 if(!await getApplicationViewer())redirect('/sign-in');
 if(!lessonId.safeParse(courseId).success||!lessonId.safeParse(segmentId).success)notFound();
 const s=await learningService(courseId,true),tree=await s.tree(),segment=tree.segments.find(x=>x.id===segmentId);
 if(!segment)notFound();
 const parts=tree.segments.filter(x=>x.lesson_id===segment.lesson_id);
 const thumbnails=await s.thumbnails(parts.flatMap(x=>x.thumbnail_asset_id?[x.thumbnail_asset_id]:[]));
 const thumbnailUrl=segment.thumbnail_asset_id?thumbnails[segment.thumbnail_asset_id]??null:null;
 if(!preview)return <LearningPartEditor key={segment.id+segment.updated_at} courseId={courseId} segment={segment} tree={tree} thumbnailUrl={thumbnailUrl}/>;
 const lesson=tree.lessons.find(l=>l.id===segment.lesson_id)!,parent=tree.modules.find(m=>m.id===lesson.module_id)!;
 let videoUrl=segment.video_asset_id?await s.media(segment.video_asset_id):segment.video_url;
 const blocks=await lessonBlockViews(tree,lesson.id,courseId,s.media);
 const blockVideo=!videoUrl?blocks.find(b=>['video','embed'].includes(b.type)&&lessonPlayback(b.mediaUrl)):undefined;
 if(blockVideo)videoUrl=blockVideo.mediaUrl;
 const videoAssetId=segment.video_asset_id??(blockVideo?tree.blocks.find(b=>b.id===blockVideo.id)?.media_asset_id:null)??null;
 return <div className="mx-auto max-w-7xl space-y-4"><Link className="text-sm font-semibold text-sky-700" href={`/self-learning/${courseId}/chapters/${segment.id}`}>← Back to segment editor</Link><Banner variant="warning" label="Teacher preview includes drafts. No student progress is recorded."/>
  <LessonTabs courseId={courseId} chapterId={segment.id} title={segment.title} chapterNumber={tree.modules.indexOf(parent)+1} chapterType={parent.group_type} courseTitle={lesson.title}
   lessonBlocks={blocks.filter(b=>b.id!==blockVideo?.id)}
   description={segment.description} playbackId={null} videoUrl={videoUrl} solutionVideoUrl={null} contentType="VIDEO_EXPLANATION" completeOnEnd={false} isCompleted={false} isWatched={false} userId="" hasSubmission={false}
   secure={{offeringId:'',revision:0,position:0,assetId:videoAssetId,status:'preview',preview:true,thumbnailUrl}}
   attachments={tree.resources.filter(r=>r.segment_id===segment.id).map(r=>({id:r.id,name:r.name,url:`/api/learning/${courseId}/resources/${r.id}`}))}
   segments={parts.map(x=>({...x,thumbnailUrl:x.thumbnail_asset_id?thumbnails[x.thumbnail_asset_id]:null,contentType:'VIDEO_EXPLANATION',href:`/self-learning/${courseId}/chapters/${x.id}?preview=1`}))}/>
 </div>;
}

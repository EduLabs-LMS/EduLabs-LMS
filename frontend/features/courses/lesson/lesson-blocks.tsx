'use client';
import { L } from '@/frontend/components/language-provider';
import Image from 'next/image';
import { lessonPlayback } from '@/shared/contracts/lessons';
export type LessonBlockView={id:string;type:string;text:string;mediaUrl:string|null;downloadUrl:string|null};
export function LessonBlocks({blocks}:{blocks:LessonBlockView[]}) {
 return <>{blocks.map(b=>{const video=['video','embed'].includes(b.type)?lessonPlayback(b.mediaUrl):null;
  return <div key={b.id} className="rounded-xl border-2 border-black bg-slate-50/60 p-5 text-slate-800 leading-relaxed text-sm sm:text-base space-y-3">
   {b.text&&(b.type==='heading'?<h2 className="text-lg font-bold">{b.text}</h2>:<p className="whitespace-pre-wrap">{b.text}</p>)}
   {video?.kind==='video'&&<video controls preload="metadata" src={video.url} className="aspect-video w-full rounded-xl bg-black"/>}
   {video?.kind==='embed'&&<iframe title={b.text||'Lesson video'} src={video.url} allowFullScreen className="aspect-video w-full rounded-xl bg-black"/>}
   {b.type==='image'&&b.mediaUrl&&<Image unoptimized src={b.mediaUrl} alt={b.text||'Lesson resource'} width={800} height={600} className="max-h-96 w-auto rounded-lg object-contain"/>}
   {b.downloadUrl&&<a href={b.downloadUrl} target="_blank" rel="noreferrer" className="text-green-900 font-semibold underline">{b.text||<L id="lesson.resource"/>}</a>}
   {!b.text&&!video&&!b.downloadUrl&&!(b.type==='image'&&b.mediaUrl)&&<p role="alert" className="text-slate-500"><L id="common.this_lesson_content_is_unavailable"/></p>}
  </div>;
 })}</>;
}

'use client';
import { L, Localized } from '@/frontend/components/language-provider';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/frontend/components/ui/button';
import { lessonPlayback } from '@/shared/contracts/lessons';
import { markLearningOverviewDirty } from '@/frontend/features/self-learning/learning-overview-freshness';

export type SecurePlayerData={offeringId:string;revision:number;position:number;assetId:string|null;status:string;thumbnailUrl?:string|null;preview?:boolean};
export function SecureLessonPlayer({courseId,segmentId,url,data}:{courseId:string;segmentId:string;url:string|null;data:SecurePlayerData}) {
 const router=useRouter(),video=useRef<HTMLVideoElement>(null),revision=useRef(data.revision),position=useRef(data.position),saving=useRef(false),lastSave=useRef(0),pendingComplete=useRef(false),active=useRef(false),savedPosition=useRef(data.position),recorded=useRef(data.revision>0);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[source,setSource]=useState(url),[completed,setCompleted]=useState(data.status==='completed');
 const restored=useRef(false);
 const restorePosition=useCallback(()=>{
  const player=video.current;
  if(!player||player.readyState<1||restored.current)return;
  restored.current=true;
  const duration=Number.isFinite(player.duration)?player.duration:position.current;
  player.currentTime=Math.min(position.current,Math.max(0,duration));
 },[]);
 // SSR/preloaded media can fire loadedmetadata before hydration attaches handlers.
 useEffect(()=>{restored.current=false;restorePosition();},[source,restorePosition]);
 const playback=lessonPlayback(source);
 const save=useCallback(async(complete=false):Promise<void>=>{
  if(data.preview)return;
  if(!complete&&recorded.current&&Math.floor(position.current)===savedPosition.current)return;
  active.current=true;
  if(saving.current){if(complete)pendingComplete.current=true;return;} saving.current=true;setBusy(true);setError('');
  const saved=Math.floor(position.current);
  try {const r=await fetch(`/api/learning/${courseId}/progress`,{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({offeringId:data.offeringId,segmentId,position:saved,complete,revision:revision.current})});const v=await r.json();if(!r.ok)throw new Error(v.error);revision.current=v.revision;savedPosition.current=saved;recorded.current=true;lastSave.current=Date.now();setCompleted(v.status==='completed');markLearningOverviewDirty({key:`${data.offeringId}:${segmentId}`,revision:v.revision});if(complete){active.current=false;router.refresh();}}
  catch(e){setError(e instanceof Error?e.message:'Progress could not be saved');}finally{saving.current=false;setBusy(false);if(pendingComplete.current){pendingComplete.current=false;void save(true);}}
 },[courseId,data.offeringId,data.preview,segmentId,router]);
 useEffect(()=>{
  const leave=()=>{if(active.current&&document.visibilityState==='hidden')void save();};document.addEventListener('visibilitychange',leave);
  return()=>{document.removeEventListener('visibilitychange',leave);if(active.current)void save();};
 },[save]);
 useEffect(()=>{
  if(!data.assetId)return;
  const refresh=async()=>{try{const r=await fetch(`/api/learning/${courseId}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:data.assetId})});const v=await r.json();if(r.ok){position.current=video.current?.currentTime??position.current;setSource(v.url);}else setError(v.error||'Media access expired');}catch{setError('Media access could not be refreshed. Retry or contact your teacher.');}};
  const timer=setInterval(()=>void refresh(),8*60*1000);return()=>clearInterval(timer);
 },[courseId,data.assetId]);
 return <div className="space-y-3">
  <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border-2 border-black shadow-hard-sm">
   {playback?.kind==='video'?<video ref={video} controls preload="metadata" className="aspect-video w-full bg-black" src={playback.url} poster={data.thumbnailUrl??undefined}
    onLoadedMetadata={()=>{restored.current=false;restorePosition();}}
    onPlay={()=>{restorePosition();void save();}} onTimeUpdate={()=>{if(!restored.current)return;position.current=video.current?.currentTime??position.current;if(Date.now()-lastSave.current>15000)void save();}}
    onPause={()=>void save()} onEnded={()=>void save(true)} onError={()=>setError('This video is unavailable. Retry or contact your teacher.')}/>
   :playback?.kind==='embed'?<Localized as="iframe" labels={{"title":"common.lesson_explanation_video"}} className="aspect-video w-full bg-black" src={playback.url} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen onLoad={()=>void save()}/>
   :<div className="flex aspect-video items-center justify-center p-6 text-center text-slate-400">{url?<L id="lesson.unsupported"/>:<L id="lesson.noVideo"/>}</div>}
  </div>
  {!data.preview&&<div className="flex flex-wrap gap-3 items-center"><Button disabled={busy||completed} onClick={()=>void save(true)}>{completed?<L id="common.completed"/>:<L id="lesson.complete"/>}</Button>{!completed&&<Button variant="outline" disabled={busy} onClick={()=>void save()}><L id="common.save_progress"/></Button>}<span className="text-xs text-slate-500">{completed?<L id="common.completed"/>:revision.current>0?<L id="common.inProgressTitle"/>:<L id="common.notStartedTitle"/>}</span></div>}
  {playback?.kind==='embed'&&<p className="text-xs text-slate-500"><L id="common.external_video_providers_do_not"/></p>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 </div>;
}

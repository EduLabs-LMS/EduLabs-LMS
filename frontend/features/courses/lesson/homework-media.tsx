'use client';
import { useEffect,useRef,useState } from 'react';
import Image from 'next/image';
import { homeworkApi } from '@/frontend/lib/homework';
import { lessonPlayback } from '@/shared/contracts/lessons';
import type { HomeworkFile } from '@/shared/contracts/homework';
export function HomeworkMedia({assignmentId,id,video=false}:{assignmentId:string;id:string;video?:boolean}) {
 const player=useRef<HTMLVideoElement>(null),resume=useRef({time:0,playing:false});
 const [file,setFile]=useState<HomeworkFile|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const load=()=>homeworkApi<HomeworkFile>(assignmentId,'media',{id}).then(v=>{if(active){if(player.current)resume.current={time:player.current.currentTime,playing:!player.current.paused};setFile(v);setError('');}}).catch(e=>{if(active){setFile(null);setError(e.message);}});void load();const timer=setInterval(()=>void load(),4*60*1000);return()=>{active=false;clearInterval(timer);};},[assignmentId,id]);
 if(error)return <p role="alert" className="text-sm text-red-700">{error}</p>;if(!file?.url)return <p role="status" className="text-xs">Loading authorized file…</p>;
 if(video)return <video ref={player} onLoadedMetadata={()=>{if(player.current){player.current.currentTime=Math.min(resume.current.time,Number.isFinite(player.current.duration)?player.current.duration:resume.current.time);if(resume.current.playing)void player.current.play().catch(()=>{});}}} controls src={file.url} className="w-full aspect-video rounded-xl bg-black" onError={()=>setError('Solution video is unavailable. Retry or contact your teacher.')}/>;
 return <a href={file.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-green-900 underline">{file.name}</a>;
}
export function HomeworkReferenceImage({assignmentId,id}:{assignmentId:string;id:string}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');useEffect(()=>{let alive=true;void homeworkApi<HomeworkFile>(assignmentId,'media',{id}).then(v=>{if(alive)setUrl(v.url??'');}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[assignmentId,id]);
 return error?<p role="alert">{error}</p>:url?<a target="_blank" rel="noreferrer" href={url}><Image unoptimized src={url} width={900} height={600} className="max-h-96 w-full object-contain rounded-xl" alt="Homework question reference; open full image"/></a>:<p className="text-xs">Loading question reference…</p>;
}
export function HomeworkSolutionVideo({url}:{url:string}){const p=lessonPlayback(url);return p?.kind==='video'?<video controls src={p.url} className="aspect-video w-full rounded-xl bg-black"/>:p?.kind==='embed'?<iframe className="aspect-video w-full rounded-xl" title="Homework solution walkthrough" src={p.url} allowFullScreen/>:<p role="alert">The solution source is unavailable.</p>;}

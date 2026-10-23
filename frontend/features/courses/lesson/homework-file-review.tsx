'use client';
import { useEffect,useRef,useState } from 'react';
import Image from 'next/image';
import { homeworkApi } from '@/frontend/lib/homework';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import type { HomeworkFile,HomeworkAnnotation } from '@/shared/contracts/homework';
type Region={x:number;y:number;width:number;height:number};
export function HomeworkFileReview({assignmentId,file,annotations,canAnnotate=false,onAnnotate}:{assignmentId:string;file:HomeworkFile;annotations:HomeworkAnnotation[];canAnnotate?:boolean;onAnnotate?:(value:Region&{page:number;note:string;fileId:string})=>Promise<void>}) {
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[page,setPage]=useState(1),[pages,setPages]=useState(1),[region,setRegion]=useState<Region|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[rendering,setRendering]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null),surface=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{let alive=true;void homeworkApi<HomeworkFile>(assignmentId,'media',{id:file.id}).then(v=>{if(alive)setUrl(v.url??'');}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[assignmentId,file.id]);
 useEffect(()=>{
  if(!url||file.mime!=='application/pdf')return;let alive=true;let cancel:(()=>void)|undefined;setRendering(true);setError('');
  void (async()=>{const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();const loading=pdfjs.getDocument({url,enableXfa:false});cancel=()=>void loading.destroy();const pdf=await loading.promise;if(!alive)return;setPages(pdf.numPages);const p=await pdf.getPage(Math.min(page,pdf.numPages)),viewport=p.getViewport({scale:1.5}),node=canvas.current;if(!node)return;node.width=viewport.width;node.height=viewport.height;const context=node.getContext('2d');if(!context)throw new Error('PDF canvas unavailable');const task=p.render({canvas:node,canvasContext:context,viewport});await task.promise;if(alive)setRendering(false);})().catch(e=>{if(alive){setError('This PDF cannot be rendered safely. '+(e instanceof Error?e.message:''));setRendering(false);}});
  return()=>{alive=false;cancel?.();};
 },[file.mime,url,page]);
 const coordinate=(clientX:number,clientY:number)=>{const rect=surface.current!.getBoundingClientRect();return {x:Math.min(.999,Math.max(0,(clientX-rect.left)/rect.width)),y:Math.min(.999,Math.max(0,(clientY-rect.top)/rect.height))};};
 return <section className="space-y-3 rounded-xl border-2 border-black bg-white p-3 min-w-0"><h3 className="font-semibold text-sm">{file.name}</h3>
  {file.mime==='application/pdf'&&<div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={page<=1||rendering} onClick={()=>{setPage(page-1);setRegion(null);}}>Previous page</Button><span className="text-xs">Page {page} of {pages}</span><Button size="sm" disabled={page>=pages||rendering} onClick={()=>{setPage(page+1);setRegion(null);}}>Next page</Button></div>}
  {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}{!url&&<p role="status">Loading private file…</p>}{rendering&&<p role="status">Rendering PDF page…</p>}
  {url&&<div ref={surface} className={`relative w-full overflow-hidden rounded-lg border ${canAnnotate?'cursor-crosshair touch-none':''}`} onPointerDown={e=>{if(!canAnnotate||rendering)return;e.preventDefault();start.current=coordinate(e.clientX,e.clientY);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerCancel={()=>{start.current=null;}} onPointerUp={e=>{if(!start.current)return;const end=coordinate(e.clientX,e.clientY),x=Math.min(start.current.x,end.x),y=Math.min(start.current.y,end.y);setRegion({x,y,width:Math.min(1-x,Math.max(.03,Math.abs(end.x-start.current.x))),height:Math.min(1-y,Math.max(.03,Math.abs(end.y-start.current.y)))});start.current=null;}}>
   {file.mime==='application/pdf'?<canvas ref={canvas} className="block h-auto w-full" aria-label={`${file.name}, page ${page}`}/>:<Image unoptimized draggable={false} src={url} alt={file.name} width={1200} height={1600} className="block h-auto w-full object-contain"/>}
   {annotations.filter(a=>a.fileId===file.id&&a.page===page).map((a,i)=><div key={a.id} title={a.note} role="img" aria-label={`Correction ${i+1}: ${a.note}`} className="absolute border-2 border-red-600 bg-red-200/20 pointer-events-none" style={{left:a.x*100+'%',top:a.y*100+'%',width:a.width*100+'%',height:a.height*100+'%'}}><span className="bg-red-700 text-white text-xs px-1">{i+1}</span></div>)}
   {region&&<div className="absolute border-2 border-sky-600 bg-green-100/30 pointer-events-none" style={{left:region.x*100+'%',top:region.y*100+'%',width:region.width*100+'%',height:region.height*100+'%'}}/>}
  </div>}
  {canAnnotate&&<div className="space-y-2"><p className="text-xs">Drag over a region of the page, or enter normalized coordinates for keyboard access.</p><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{(['x','y','width','height'] as const).map(k=><label className="text-xs" key={k}>{k}<Input aria-label={`Annotation ${k}`} type="number" min={0} max={1} step={.01} value={region?.[k]??''} onChange={e=>setRegion({...region??{x:0,y:0,width:.1,height:.1},[k]:Number(e.target.value)})}/></label>)}</div><Textarea aria-label="Positioned correction note" value={note} onChange={e=>setNote(e.target.value)} maxLength={4000}/><Button disabled={busy||!region||!note.trim()||rendering} onClick={async()=>{if(!region||!onAnnotate)return;setBusy(true);setError('');try{await onAnnotate({...region,page,note,fileId:file.id});setNote('');setRegion(null);}catch(e){setError(e instanceof Error?e.message:'Annotation save failed');}finally{setBusy(false);}}}>Save positioned note</Button></div>}
  <ol className="space-y-2 text-sm">{annotations.filter(a=>a.fileId===file.id&&a.page===page).map((a,i)=><li key={a.id}><strong>{i+1}.</strong> {a.note}</li>)}</ol>
  {url&&<a href={url} target="_blank" rel="noreferrer" className="text-xs text-green-900 underline">Open original file</a>}
 </section>;
}

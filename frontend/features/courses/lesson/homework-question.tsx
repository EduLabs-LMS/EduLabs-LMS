'use client';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { compactHomeworkChoices,type HomeworkQuestion as Question,type HomeworkAnswer } from '@/shared/contracts/homework';
/** Shared verbatim by teacher preview and learners; blank text is real book-reference content. */
export function HomeworkQuestion({question:q,number,answer,onChange,imageUrl,reference,disabled=false,upload,files}:{question:Question;number:number;answer:HomeworkAnswer;onChange:(value:HomeworkAnswer)=>void;imageUrl?:string;reference?:ReactNode;disabled?:boolean;upload?:(file:File)=>Promise<void>;files?:{id:string;name:string}[]}) {
 const compact=compactHomeworkChoices(q);
 const fullyCompact=compact&&!q.text.trim()&&!q.imageId&&!imageUrl&&!reference;
 return <fieldset disabled={disabled} className="min-w-0 rounded-xl border-2 border-black bg-white p-4 space-y-3">
  <legend className={fullyCompact?'sr-only':'px-1 text-sm font-bold'}>Q{number}</legend>
  {q.text.trim()&&<p className="whitespace-pre-wrap break-words text-sm">{q.text}</p>}
  {reference}
  {imageUrl&&<a href={imageUrl} target="_blank" rel="noreferrer" className="block"><Image unoptimized width={900} height={600} className="max-h-96 w-full object-contain rounded-lg" src={imageUrl} alt={`Question ${number} reference; open full image`}/></a>}
  {q.type==='essay'?<div className="space-y-3">{q.responseMode!=='photo'&&<Textarea aria-label={`Question ${number} written answer`} value={answer.text} onChange={e=>onChange({...answer,text:e.target.value})} maxLength={20000}/>}
   {q.responseMode!=='text'&&<><label className="block text-sm font-semibold">Handwritten answer — choose photo<Input aria-label={`Question ${number} photo answer`} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={disabled||!upload} onChange={e=>{const f=e.target.files?.[0];if(f&&upload)void upload(f);}}/></label><label className="block text-sm">Take a photo<Input aria-label={`Question ${number} camera`} type="file" accept="image/*" capture="environment" disabled={disabled||!upload} onChange={e=>{const f=e.target.files?.[0];if(f&&upload)void upload(f);}}/></label>{files?.map(f=><p key={f.id} className="text-sm">{f.name}</p>)}</>}
  </div>:<div role={q.type==='single_choice'?'radiogroup':'group'} aria-label={`Question ${number} options`} className={compact?'flex flex-wrap items-center gap-2':'grid gap-2'}>
   {fullyCompact&&<span aria-hidden="true" className="mr-1 font-bold text-sm">Q{number}</span>}
   {q.options.map((o,i)=><label key={o.id} className={`flex min-h-11 min-w-11 items-center gap-2 rounded-lg border p-2 cursor-pointer focus-within:ring-2 focus-within:ring-sky-600 ${!compact&&!o.text.trim()?'justify-self-start':''} ${answer.optionIds.includes(o.id)?'border-sky-600 bg-green-50':'border-slate-200'}`}>
    <input type={q.type==='single_choice'?'radio':'checkbox'} name={`homework-${q.id}`} aria-label={`Question ${number}, option ${String.fromCharCode(65+i)}`} checked={answer.optionIds.includes(o.id)} onChange={e=>onChange({...answer,optionIds:q.type==='single_choice'?[o.id]:e.target.checked?[...answer.optionIds,o.id]:answer.optionIds.filter(v=>v!==o.id)})}/>
    <span className="font-bold text-sm">{String.fromCharCode(65+i)}</span>{o.text.trim()&&<span className="whitespace-pre-wrap break-words text-sm">{o.text}</span>}
   </label>)}
  </div>}
 </fieldset>;
}

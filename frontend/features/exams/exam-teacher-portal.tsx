'use client';
import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { ExamBuilder } from '@/frontend/features/exams/exam-builder';
import { ExamsListView } from '@/frontend/features/exams/exams-list';
import type { ExamListItem } from '@/shared/contracts/exam-listing';

export function ExamTeacherPortal({items,isStaff,truncated,offerings}:{items:ExamListItem[];isStaff:boolean;truncated:boolean;offerings:{id:string;name:string;courseTitle:string}[]}) {
 const [creating,setCreating]=useState(false),[selected,setSelected]=useState(''),[editing,setEditing]=useState(false);
 if(editing&&selected)return <ExamBuilder examId={null} secure offeringId={selected} onClose={changed=>{setEditing(false);setCreating(false);if(changed)window.location.reload();}} />;
 return <>
  <ExamsListView items={items} isStaff={isStaff} truncated={truncated} action={offerings.length>0?<Button onClick={()=>setCreating(true)}><PlusCircle className="mr-2 h-4 w-4" />Create Exam</Button>:undefined} />
  {creating&&<div className="mx-auto max-w-3xl space-y-4 rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm">
   <label className="block text-sm font-semibold" htmlFor="exam-offering">Course and group / offering</label>
   <Dropdown id="exam-offering" value={selected} onChange={event=>setSelected(event.target.value)} className="w-full rounded-xl border-2 border-black bg-white p-3"><option value="">Select a course and offering</option>{offerings.map(o=><option key={o.id} value={o.id}>{o.courseTitle} — {o.name}</option>)}</Dropdown>
   <div className="flex gap-2"><Button disabled={!selected} onClick={()=>setEditing(true)}>Continue to exam builder</Button><Button variant="outline" onClick={()=>setCreating(false)}>Cancel</Button></div>
  </div>}
 </>;
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { groupSummarySchema } from '@/shared/contracts/groups';
import type { GroupSummary } from '@/shared/contracts/groups';

export function useGroupSummary(enabled:boolean,groupId:string|null=null) {
 const [data,setData]=useState<GroupSummary|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(enabled),[revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{
  setData(null);setError('');setLoading(enabled);if(!enabled)return;
  let active=true,controller:AbortController|undefined;
  const load=async()=>{controller?.abort();controller=new AbortController();const timer=setTimeout(()=>controller?.abort(),15000);try{
   const response=await fetch('/api/study-groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'view',groupId,data:{section:'summary'}}),signal:controller.signal});
   const value=await response.json();if(!response.ok)throw Error(value.error||'Session summary unavailable');const parsed=groupSummarySchema.parse(value);if(active){setData(parsed);setError('');}
  }catch(e){if(active){setData(null);setError(e instanceof Error&&e.name==='AbortError'?'Session summary timed out. Retry.':e instanceof Error?e.message:'Session summary unavailable');}}finally{clearTimeout(timer);if(active)setLoading(false);}};
  void load();const interval=setInterval(load,30000);return()=>{active=false;controller?.abort();clearInterval(interval);};
 },[enabled,groupId,revision]);
 return {data,error,loading,refresh};
}

'use client';
import { getFirebaseAuth,restoreFirebaseAuth } from '@/frontend/lib/firebase';
import { getSupabaseConfig } from '@/shared/supabase-config';
import { lessonFileFormats,validLessonFile } from '@/shared/contracts/lessons';
export async function homeworkApi<T>(id:string,action:string,body:unknown):Promise<T>{const r=await fetch(`/api/homework/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Object.assign(new Error(v.error||'Homework request failed'),{status:r.status,reason:typeof v.reason==='string'?v.reason:undefined});return v as T;}
export async function uploadHomeworkFile(assignmentId:string,file:File,purpose:'reference'|'question'|'solution'|'submission',submissionId:string|null,onProgress:(percent:number)=>void) {
 const format=lessonFileFormats[file.type];if(!Object.prototype.hasOwnProperty.call(lessonFileFormats,file.type)||!format||file.size>format.limit||!validLessonFile(new Uint8Array(await file.arrayBuffer()),file.type))throw new Error('Use a supported, valid PDF/image (or solution MP4) within the file limit.');
 const intent=await homeworkApi<{id:string;path:string}>(assignmentId,'upload-intent',{purpose,submissionId,name:file.name,mime:file.type});
 try {
  await restoreFirebaseAuth();const token=await getFirebaseAuth().currentUser?.getIdToken();if(!token)throw new Error('Sign in again before uploading.');const {url,publishableKey}=getSupabaseConfig();
  await new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',`${url}/storage/v1/object/lms-homework/${intent.path}`);xhr.setRequestHeader('Authorization','Bearer '+token);xhr.setRequestHeader('apikey',publishableKey);xhr.setRequestHeader('Content-Type',file.type);xhr.setRequestHeader('x-upsert','false');xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};xhr.onerror=()=>reject(new Error('Upload connection failed.'));xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('Storage rejected this upload.'));xhr.send(file);});
  return await homeworkApi<{id:string;name:string;mime:string}>(assignmentId,'finish-upload',{id:intent.id});
 }catch(e){try{await homeworkApi(assignmentId,'cleanup',{id:intent.id});}catch{throw new Error(`Upload failed. Exact file ${intent.id} retained for safe cleanup.`);}throw e;}
}

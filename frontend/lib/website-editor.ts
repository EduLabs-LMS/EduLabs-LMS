import type { WebsiteWrite, WebsiteEditorState } from '@/shared/contracts/website-editor';
export async function websiteEditorRequest(organizationId:string,input?:WebsiteWrite,signal?:AbortSignal):Promise<WebsiteEditorState|{saved:true}> {
 const response=await fetch('/api/teacher/website'+(input?'':'?'+new URLSearchParams({organizationId})),input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal}:{cache:'no-store',signal});
 const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'Website data is unavailable.'),{status:response.status});return value;
}

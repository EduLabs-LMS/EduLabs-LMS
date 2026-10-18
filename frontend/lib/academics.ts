import type { AcademicWrite } from '@/shared/contracts/academics';
export async function academicRequest<T>(query: Record<string,string>,input?:AcademicWrite,signal?:AbortSignal):Promise<T> {
 const response=await fetch('/api/teacher/academics'+(input?'':'?'+new URLSearchParams(query)),input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal}:{cache:'no-store',signal});
 const value=await response.json();
 if(!response.ok)throw Object.assign(new Error(value.error||'Academic data is unavailable.'),{status:response.status});
 return value as T;
}

import { renderToReadableStream } from 'react-dom/server.browser';
import { isFirebaseStaging } from '@/shared/auth-config';
import { publicWebsiteRoute, visitorQuery, publicWebsitePath } from '@/shared/public-website';
import { publicRequestOrigin, allowPublicRequest, readPublicWebsite, publicSitemap, publicFailure } from '@/server/services/public-website';
import { TeacherPublicSite, PublicWebsiteError } from '@/frontend/features/public-website/teacher-site';
const headers={'Cache-Control':'no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Robots-Tag':'noindex, nofollow'};
async function html(element:React.ReactElement,status:number,extra:Record<string,string>={}){
 // Buffer before sending headers: a missing site must never become a streamed HTTP 200.
 const stream=await renderToReadableStream(element);await stream.allReady;const content=await new Response(stream).text();
 return new Response(content,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8',...extra}});
}
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export async function publicWebsiteHTTP(request:Request){
 const route=publicWebsiteRoute(new URL(request.url).pathname);let origin:string|undefined;
 try{
  if(!route||!isFirebaseStaging())throw publicFailure('Website or course not found.',404);
  origin=publicRequestOrigin(request);
  const params=new URL(request.url).searchParams;if(Array.from(params.keys()).some(k=>params.getAll(k).length!==1))throw publicFailure('Invalid public query.',400);
  // Native GET forms submit an empty stage for All stages; normalize only this deliberate value.
  if(params.get('stage')==='')params.delete('stage');
  if(route.kind!=='home'&&params.size)throw publicFailure('This public route does not accept query parameters.',400);
  const parsed=visitorQuery.safeParse(Object.fromEntries(params));if(!parsed.success)throw publicFailure('Invalid stage, cursor or page size.',400);
  await allowPublicRequest(route.slug,route.kind==='sitemap'?4:parsed.data.after?2:1);
  if(route.kind==='sitemap'){
   const courses=await publicSitemap(route.slug),urls=[publicWebsitePath(route.slug),...courses.map(id=>publicWebsitePath(route.slug,id))];
   return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(path=>'<url><loc>'+xml(new URL(path,origin).href)+'</loc></url>').join('')+'</urlset>',{headers:{...headers,'X-Robots-Tag':'noindex','Content-Type':'application/xml; charset=utf-8'}});
  }
  const catalog=await readPublicWebsite(route.slug,parsed.data,route.courseId),csp=`default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`;
  return await html(<TeacherPublicSite catalog={catalog} origin={origin} query={parsed.data} courseId={route.courseId}/>,200,{'Content-Language':catalog.site.locale,'X-Robots-Tag':parsed.data.stage||parsed.data.after||parsed.data.limit!=='12'?'noindex, follow':'index, follow','Content-Security-Policy':csp});
 }catch(e){const given=(e as {status?:number}).status,status=given&&[400,404,409,421,429,503].includes(given)?given:503,message=given?(e as Error).message:'The website is temporarily unavailable. Please retry.';
  return html(<PublicWebsiteError status={status} message={message} home={origin&&route?new URL(publicWebsitePath(route.slug),origin).href:undefined}/>,status,{'Content-Security-Policy':"default-src 'none'; style-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",...(status===429?{'Retry-After':String((e as {retryAfter?:number}).retryAfter??60)}:status===503?{'Retry-After':'30'}:{})});
 }
}

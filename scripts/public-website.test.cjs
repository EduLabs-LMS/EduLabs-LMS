const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript');
function load(file,deps={},globals={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Buffer,URL,URLSearchParams,Set,Number,fetch,Request,Response,AbortSignal,process,...globals,require:n=>n==='server-only'?{}:n in deps?deps[n]:require(n)});return m.exports;}
const base=load('shared/contracts/teacher-websites.ts'),c=load('shared/public-website.ts');
const org='20000000-0000-0000-0000-000000000001',course='30000000-0000-0000-0000-000000000001',stage='50000000-0000-0000-0000-000000000001',program='40000000-0000-0000-0000-000000000001';
const config={displayName:'Fictional academy',heroTitle:'A new chapter',heroSubtitle:'Approved subtitle',about:'Approved copy',locale:'en',theme:'green',accent:'green',ctaLabel:'Register',ctaTarget:'sign-up',sections:['hero','about','programs','courses']};
const page={slug:'fictional-academy',version:org,revision:1,site:config,stages:[{id:stage,label:'First stage',programId:program,programLabel:'Program',position:0,programPosition:0}],courses:[{id:course,title:'Public physics',summary:'Approved summary',assetId:null,stageIds:[]}],hasMore:false,next:null};
test('public routing is an exact bounded family, never a wildcard academic route',()=>{
 for(const path of ['/t/fictional-academy','/t/fictional-academy/sitemap.xml','/t/fictional-academy/courses/'+course])assert.ok(c.publicWebsiteRoute(path));
 for(const path of ['/t','/t/../admin','/t/Site','/t/a','/t/fictional-academy/admin','/t/fictional-academy/','/t/fictional-academy/courses/private','/t/fictional-academy/courses/'+course+'/lessons','/teacher/website','/api/teacher/website'])assert.equal(c.publicWebsiteRoute(path),null);
});
test('visitor queries reject extra/private scope, non-UUID cursor/stage and unbounded sizes',()=>{
 for(const v of [{organizationId:org},{userId:org},{stage:'all'},{after:'forged'},{limit:'50'},{limit:'0'},{limit:'012'},{limit:'1e1'}])assert.equal(c.visitorQuery.safeParse(v).success,false);
 assert.equal(c.visitorQuery.parse({}).limit,'12');assert.ok(c.publicCatalogHref('fictional-academy',{stage,after:course}).includes('stage='+stage));assert.ok(!c.publicCatalogHref('fictional-academy',{stage}).includes('after='));
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';assert.equal(c.visitorQuery.parse({stage:id.toUpperCase()}).stage,id);assert.equal(c.publicWebsiteRoute('/t/fictional-academy/courses/'+id.toUpperCase()).courseId,id);assert.equal(c.publicWebsitePath('fictional-academy',id.toUpperCase()),'/t/fictional-academy/courses/'+id);
});
test('trusted platform origin and auth links cannot be supplied by visitor targets',()=>{
 const o='https://platform.example';assert.equal(c.publicPlatformOrigin(o),o);
 for(const value of [undefined,'//evil.example','http://evil.example','https://user:password@platform.example','https://platform.example/path','https://platform.example/','https://platform.example?x=1'])assert.throws(()=>c.publicPlatformOrigin(value));
 assert.equal(c.publicPlatformOrigin('http://127.0.0.1:3000',true),'http://127.0.0.1:3000');
 const links=c.publicAuthLinks(o,'fictional-academy');for(const key of ['signin','signup','access','home'])assert.equal(new URL(links[key]).origin,o);assert.equal(new URL(links.signup).searchParams.get('next'),'/access');assert.throws(()=>c.publicAuthLinks(o,'../../admin'));
});
test('catalog result integrity rejects wrong slug, duplicates, ordering, stage scope and bad continuation',()=>{
 assert.equal(c.validatePublicPage(page,page.slug,12),page);
 for(const v of [{...page,slug:'other-site'},{...page,courses:[page.courses[0],page.courses[0]]},{...page,hasMore:true,next:null},{...page,hasMore:false,next:course},{...page,courses:[{...page.courses[0],stageIds:[org]}]}])assert.throws(()=>c.validatePublicPage(v,page.slug,12));
 assert.throws(()=>c.validatePublicPage(page,page.slug,12,course));assert.throws(()=>c.validatePublicPage(page,page.slug,12,undefined,stage));
});
function serviceFixture({pages=[page],fetcher=async()=>new Response(JSON.stringify({allowed:true,retryAfterSeconds:60})),env={}}={}){
 const calls=[];const service=load('server/services/public-website.ts',{'@/server/integrations/public-catalog':{anonymousCatalogClient:()=>({rpc:async(name,args)=>{calls.push({name,args});const v=pages.shift();return v?.error?{error:{message:'PRIVATE SQL'},data:null}:{error:null,data:v===undefined?null:v};}})},'@/shared/contracts/teacher-websites':base,'@/shared/public-website':c}, {fetch:fetcher,process:{env}});return {...service,calls};
}
test('public reads use only the named projection RPC and translate missing/error responses honestly',async()=>{
 const f=serviceFixture();assert.equal((await f.readPublicWebsite(page.slug,{limit:'12'})).courses[0].title,'Public physics');assert.equal(f.calls[0].name,'public_teacher_catalog');assert.equal(f.calls[0].args.p_slug,page.slug);assert.equal(f.calls[0].args.p_limit,12);
 for(const [pages,status] of [[[null],404],[[{error:true}],503],[[{...page,teacherEmail:'PRIVATE'}],503],[[{...page,courses:[{...page.courses[0],description:'PRIVATE'}]}],503]])await assert.rejects(()=>serviceFixture({pages}).readPublicWebsite(page.slug,{limit:'12'}),e=>e.status===status&&!e.message.includes('PRIVATE'));
});
test('cursor belongs to this public site/stage; hidden or wrong-tenant cursor never becomes a false empty page',async()=>{
 const next={...page,courses:[],hasMore:false,next:null};let f=serviceFixture({pages:[next,page]});await f.readPublicWebsite(page.slug,{limit:'12',after:course});assert.equal(f.calls[1].args.p_course_id,course);
 for(const [cursor,status] of [[null,400],[{...page,version:stage},409],[{...page,slug:'other-site'},503]])await assert.rejects(()=>serviceFixture({pages:[next,cursor]}).readPublicWebsite(page.slug,{limit:'12',after:course}),{status});
});
test('sitemap follows bounded live projection pages and rejects publication races and truncation',async()=>{
 const first={...page,hasMore:true,next:course};const last={...page,courses:[]};assert.equal((await serviceFixture({pages:[first,last]}).publicSitemap(page.slug)).length,1);
 await assert.rejects(()=>serviceFixture({pages:[first,{...last,version:stage}]}).publicSitemap(page.slug),{status:503});await assert.rejects(()=>serviceFixture({pages:[null]}).publicSitemap(page.slug),{status:404});
});
test('Host and forwarding headers cannot choose the canonical origin or tenant',()=>{
 const f=serviceFixture({env:{APP_ORIGIN:'https://platform.example'}});assert.equal(f.publicRequestOrigin(new Request('https://evil.example/t/x',{headers:{Host:'platform.example','X-Forwarded-Host':'evil.example'}})),'https://platform.example');
 assert.throws(()=>f.publicRequestOrigin(new Request('https://platform.example/t/x',{headers:{Host:'evil.example'}})),{status:421});
 assert.throws(()=>serviceFixture({env:{APP_ORIGIN:'https://user:pass@platform.example'}}).publicRequestOrigin(new Request('https://platform.example')),{status:503});
});
test('durable gateway is required and fails closed without trusting client IPs or local counters',async()=>{
 await assert.rejects(()=>serviceFixture().allowPublicRequest(page.slug,1),{status:503});
 const env={PUBLIC_WEBSITE_RATE_LIMIT_URL:'https://gateway.example/consume',PUBLIC_WEBSITE_RATE_LIMIT_TOKEN:'fixture-token'};let received;
 await serviceFixture({env,fetcher:async(url,init)=>{received=JSON.parse(init.body);assert.equal(init.redirect,'error');return new Response(JSON.stringify({allowed:true,retryAfterSeconds:60}));}}).allowPublicRequest(page.slug,2);assert.equal(received.cost,2);assert.equal(received.site,page.slug);assert.equal('ip' in received,false);
 await assert.rejects(()=>serviceFixture({env,fetcher:async()=>new Response(JSON.stringify({allowed:false,retryAfterSeconds:12}))}).allowPublicRequest(page.slug,1),e=>e.status===429&&e.retryAfter===12);
 for(const fetcher of [async()=>{throw Error('PRIVATE')},async()=>new Response('{}'),async()=>new Response('bad',{status:500})])await assert.rejects(()=>serviceFixture({env,fetcher}).allowPublicRequest(page.slug,1),{status:503});
});
test('visitor React HTML escapes copy, respects hidden sections and does not serialize private media capabilities',()=>{
 const {TeacherPublicSite}=load('frontend/features/public-website/teacher-site.tsx',{'@/shared/public-website':c}),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const html=renderToStaticMarkup(React.createElement(TeacherPublicSite,{catalog:{...page,site:{...config,heroTitle:'<script>alert(1)</script>',sections:['about','hero']}},origin:'https://platform.example',query:{limit:'12'}}));
 assert.ok(html.includes('&lt;script&gt;'));assert.equal(html.includes('<script>'),false);assert.ok(html.indexOf('id="about"')<html.indexOf('id="hero"'));assert.equal(html.includes('id="courses"'),false);assert.equal(html.includes('firebase'),false);assert.equal(html.includes('object_path'),false);assert.equal(html.includes('storage/v1'),false);assert.ok(html.includes('rel="canonical" href="https://platform.example/t/fictional-academy"'));
 const hidden=renderToStaticMarkup(React.createElement(TeacherPublicSite,{catalog:{...page,site:{...config,heroTitle:'HIDDEN_HERO_SENTINEL',heroSubtitle:'HIDDEN_SUBTITLE_SENTINEL',about:'HIDDEN_ABOUT_SENTINEL',sections:['courses']}},origin:'https://platform.example',query:{limit:'12'}}));assert.equal(hidden.includes('HIDDEN_'),false);assert.ok(hidden.includes('<h1 class="sr-only">Fictional academy</h1>'));
});
test('anonymous SDK has no session/cookie/accessToken bridge and forces no-store transport',()=>{
 let options;const integration=load('server/integrations/public-catalog.ts',{'@supabase/supabase-js':{createClient:(url,key,opts)=>{assert.equal(url,'https://fixture.supabase.co');assert.equal(key,'sb_publishable_fixture');options=opts;return{};}},'@/shared/supabase-config':{getSupabaseConfig:()=>({url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'})}});integration.anonymousCatalogClient();assert.equal(options.auth.persistSession,false);assert.equal(options.auth.autoRefreshToken,false);assert.equal(options.accessToken,undefined);assert.equal(options.cookies,undefined);
});
test('middleware allows only exact public paths and preserves private API gating and preview noindex',()=>{
 class NextResponse{constructor(body,options={}){this.status=options.status??200;this.headers=new Map(Object.entries(options.headers??{}));}static next(){return new NextResponse('');}static json(body,options){return new NextResponse('',options);}static redirect(){return new NextResponse('',{status:307});}}
 function middleware(mode){return load('middleware.ts',{'@/shared/public-website':c,'@/shared/website-routes':load('shared/website-routes.ts'),'@clerk/nextjs/server':{clerkMiddleware:()=>()=>new NextResponse('',{status:401}),createRouteMatcher:()=>()=>false},'@/shared/auth-config':{isFirebaseStaging:()=>mode},'next/server':{NextResponse}}).default;}
 const req=path=>({nextUrl:new URL('https://platform.example'+path),url:'https://platform.example'+path});
 assert.equal(middleware(true)(req('/t/fictional-academy'),{}).status,200);assert.equal(middleware(true)(req('/t/fictional-academy/sitemap.xml'),{}).status,200);
 for(const p of ['/t','/t/fictional-academy/private','/t/fictional-academy/courses/bad'])assert.equal(middleware(true)(req(p),{}).status,404);
 assert.equal(middleware(false)(req('/t/fictional-academy'),{}).status,404);assert.equal(middleware(true)(req('/api/unmigrated'),{}).status,503);assert.equal(middleware(true)(req('/teacher/website'),{}).headers.get('X-Robots-Tag'),'noindex, nofollow');
});

test('gateway response is byte-bounded during streaming and cancels oversized bodies',async()=>{
 const env={PUBLIC_WEBSITE_RATE_LIMIT_URL:'https://gateway.example/consume',PUBLIC_WEBSITE_RATE_LIMIT_TOKEN:'fixture-token'};let cancelled=false;
 const fetcher=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1025));},cancel(){cancelled=true;}}));
 await assert.rejects(()=>serviceFixture({env,fetcher}).allowPublicRequest(page.slug,1),{status:503});assert.equal(cancelled,true);
 await assert.rejects(()=>serviceFixture({env,fetcher:async()=>new Response(null,{status:200})}).allowPublicRequest(page.slug,1),{status:503});
});
test('buffered public rendering rejection produces sanitized 503 rather than escaping the HTTP boundary',async()=>{
 const React=require('react'),renderer=require('react-dom/server.browser'),components=load('frontend/features/public-website/teacher-site.tsx',{'@/shared/public-website':c});let calls=0;
 const {publicWebsiteHTTP}=load('app/t/_render.tsx',{'react-dom/server.browser':{renderToReadableStream:async element=>{if(!calls++)throw Error('PRIVATE_RENDER_SENTINEL');return renderer.renderToReadableStream(element);}},'@/shared/auth-config':{isFirebaseStaging:()=>true},'@/shared/public-website':c,'@/server/services/public-website':{publicRequestOrigin:()=> 'https://platform.example',allowPublicRequest:async()=>{},readPublicWebsite:async()=>page,publicFailure:(message,status)=>Object.assign(Error(message),{status})},'@/frontend/features/public-website/teacher-site':components});
 const response=await publicWebsiteHTTP(new Request('https://platform.example/t/'+page.slug));assert.equal(response.status,503);const html=await response.text();assert.equal(html.includes('PRIVATE_RENDER_SENTINEL'),false);assert.ok(html.includes('temporarily unavailable'));assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
});

test('only landing forms normalize empty stages; detail and sitemap reject even empty query fields',async()=>{
 const renderer=require('react-dom/server.browser'),components=load('frontend/features/public-website/teacher-site.tsx',{'@/shared/public-website':c});let admitted=0;
 const {publicWebsiteHTTP}=load('app/t/_render.tsx',{'react-dom/server.browser':renderer,'@/shared/auth-config':{isFirebaseStaging:()=>true},'@/shared/public-website':c,'@/server/services/public-website':{publicRequestOrigin:()=> 'https://platform.example',allowPublicRequest:async()=>{admitted++;},readPublicWebsite:async()=>page,publicFailure:(message,status)=>Object.assign(Error(message),{status})},'@/frontend/features/public-website/teacher-site':components});
 for(const path of ['/courses/'+course,'/sitemap.xml'])assert.equal((await publicWebsiteHTTP(new Request('https://platform.example/t/'+page.slug+path+'?stage='))).status,400);
 assert.equal(admitted,0);assert.equal((await publicWebsiteHTTP(new Request('https://platform.example/t/'+page.slug+'?stage='))).status,200);assert.equal(admitted,1);
});

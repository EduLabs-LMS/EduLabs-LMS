const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup:render}=require('react-dom/server');
function load(path,resolve){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:resolve});return m.exports}
const context={viewer:{displayName:'Learner'},memberships:[],courseStaff:[],offeringStaff:[]};
const empty={courses:[],offerings:[],enrollments:[],modules:[],lessons:[],progress:[],scheduled:[],assessments:[],limited:false};
function pages(scope,failure){return load('app/(dashboard)/_components/website-pages.tsx',n=>{
 if(n==='@/server/services/website')return {getWebsiteContext:async()=>context,loadWebsiteScope:async()=>{if(failure)throw Error('Load failed');return scope},courseCapability:()=>false,offeringCapability:()=>false};
 if(n==='react/jsx-runtime')return require(n);
 if(n==='next/link')return props=>React.createElement('a',props);
 if(n==='next/navigation')return {notFound:()=>{throw Error('404')},redirect:()=>{throw Error('redirect')}};
 if(n==='@/shared/v2-learning-model')return {v2StudentLessons:()=>[],v2Chapters:()=>[],v2OfferingChapters:()=>[]};
 return new Proxy({},{get:()=>()=>null});
})}
test('learner Home and Self Learning omit genuinely empty summaries and organization creation',async()=>{
 const p=pages(empty);for(const html of [render(await p.WebsiteHome({})),render(await p.WebsiteCourses({}))])assert.doesNotMatch(html,/Groups &amp; Offerings|Upcoming Assessments|Teaching tools|onboarding|Create an organization/);
});
test('incomplete scope keeps warning and cannot be mistaken for a genuine empty overview',async()=>{
 const p=pages({...empty,limited:true}),html=render(await p.WebsiteHome({}));assert.match(html,/Progress totals are unavailable/);assert.match(html,/Groups &amp; Offerings/);assert.match(html,/Assessment data is incomplete/);
});
test('failed authorized loads propagate instead of rendering empty results',async()=>{
 const p=pages(empty,true);await assert.rejects(p.WebsiteHome({}),/Load failed/);await assert.rejects(p.WebsiteCourses({}),/Load failed/);
});
test('nonempty authorized offering and published schedule summaries remain visible',async()=>{
 const p=pages({...empty,offerings:[{id:'o',name:'Group A',status:'active',delivery_mode:'live'}],scheduled:[{id:'s',offering_id:'o',assessment_id:'a',closes_at:null}],assessments:[{id:'a',title:'Quiz A',type:'quiz'}]});const html=render(await p.WebsiteHome({}));assert.match(html,/Group A/);assert.match(html,/Quiz A/);assert.match(html,/href="\/exams\/s"/);assert.doesNotMatch(html,/awaiting integration/);
});
test('organization HTTP provisioning fails closed without reaching the existing backend',async()=>{
 const route=load('server/http/managed-provisioning.ts',()=>({NextResponse:{json:(body,options)=>({body,...options})}}));assert.equal(route.managedOrganizationPOST().status,403);
});
test('real shared desktop/mobile sidebar exposes learner routes without staff affordances',()=>{
 const m=load('frontend/components/sidebar.tsx',n=>{
  if(n==='react'||n==='react/jsx-runtime')return require(n);
  if(n==='next/link')return props=>React.createElement('a',props);
  if(n==='next/navigation')return {usePathname:()=>'/home'};
  if(n==='@/shared/auth-config')return {isFirebaseStaging:()=>true};
  if(n.includes('providers/v2-identity'))return {useUser:()=>({user:{fullName:'Learner'}}),useClerk:()=>({signOut(){}}),UserButton:()=>null};
  if(n.includes('application-auth-provider'))return {useWebsiteNavigation:()=>({staffOrganizationIds:[]})};
  if(n==='@/shared/utils')return {cn:(...v)=>v.filter(Boolean).join(' ')};
  return new Proxy({},{get:()=>()=>null});
 });const html=render(React.createElement(m.default));assert.doesNotMatch(html,/href="\/(teacher|admin|onboarding)/);for(const route of ['home','self-learning','sessions-groups'])assert.match(html,new RegExp('href="/'+route+'"'));
});

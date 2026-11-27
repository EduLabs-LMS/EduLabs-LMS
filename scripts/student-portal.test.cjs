const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup:render}=require('react-dom/server');
function load(path,resolve){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:resolve});return m.exports}
const context={viewer:{displayName:'Learner'},memberships:[],courseStaff:[],offeringStaff:[],courses:[],offerings:[]};
const empty={courses:[],offerings:[],enrollments:[],modules:[],lessons:[],progress:[],limited:false,contentLimited:false,progressLimited:false};
// claude/ui-quick-fixes: the "Groups & Offerings" box became "Your Groups" (the student's own Groups from the existing group reads, streamed
// in a Suspense). These tests resolve that async server component the way the server would, then render.
const groupsRead={rows:[]};
async function resolve(node){if(node==null||typeof node!=='object')return node;if(Array.isArray(node))return Promise.all(node.map(resolve));if(!React.isValidElement(node))return node;
 // The module is transpiled to ES5 here, so a server component is simply called (an async one returns a promise); one that uses hooks throws and stays.
 if(typeof node.type==='function'&&!(node.type.prototype&&node.type.prototype.isReactComponent)){const quiet=console.error;console.error=()=>{};let out;try{out={value:node.type(node.props)};}catch{out=null;}finally{console.error=quiet;}if(out)return resolve(out.value&&typeof out.value.then==='function'?await out.value:out.value);}
 return node.props&&node.props.children!==undefined?React.cloneElement(node,{children:await resolve(node.props.children)}):node;}
const show=async tree=>render(await resolve(tree));
function pages(scope,failure){return load('app/(dashboard)/_components/website-pages.tsx',n=>{if(n==='@/frontend/components/language-provider')return require('./localization-test-loader.cjs').language();
 if(n==='react')return React;
 if(n==='@/frontend/features/groups/your-groups')return require('./localization-test-loader.cjs').load('frontend/features/groups/your-groups.tsx');
 if(n==='@/shared/contracts/groups')return require('./localization-test-loader.cjs').load('shared/contracts/groups.ts');
 if(n==='@/server/services/groups')return {groupService:async()=>({overview:async()=>groupsRead,view:async()=>({rows:[],page:0})})};
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
 const p=pages({...empty,limited:true,contentLimited:true}),html=await show(await p.WebsiteHome({}));assert.match(html,/Progress totals are unavailable/);assert.match(html,/This overview shows at most/i,'the limit is said, so it cannot read as a genuine empty overview');assert.doesNotMatch(html,/Assessment data is incomplete/);
});
test('failed authorized loads propagate instead of rendering empty results',async()=>{
 const p=pages(empty,true);await assert.rejects(p.WebsiteHome({}),/Load failed/);await assert.rejects(p.WebsiteCourses({}),/Load failed/);
});
test('nonempty authorized offering summaries remain visible and the Home has no legacy Assessments section',async()=>{
 groupsRead.rows=[{id:'g',offering_id:'o',name:'Group A',status:'active',mode:'online'}];const p=pages({...empty,offerings:[{id:'o',course_id:'c',name:'Run',status:'active',delivery_mode:'live'}]});const html=await show(await p.WebsiteHome({}));groupsRead.rows=[];assert.match(html,/Your Groups/);assert.match(html,/Group A/);assert.doesNotMatch(html,/Your enrollment|live|Groups &amp; Offerings/,'no developer text');assert.doesNotMatch(html,/Upcoming Assessments|Available Assessments|href="\/exams\//);assert.doesNotMatch(html,/awaiting integration/);
});
test('organization HTTP provisioning fails closed without reaching the existing backend',async()=>{
 const route=load('server/http/managed-provisioning.ts',()=>({NextResponse:{json:(body,options)=>({body,...options})}}));assert.equal(route.managedOrganizationPOST().status,403);
});
test('real shared desktop/mobile sidebar exposes learner routes without staff affordances',()=>{
 const m=load('frontend/components/sidebar.tsx',n=>{if(n==='@/frontend/components/language-provider')return require('./localization-test-loader.cjs').language();
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

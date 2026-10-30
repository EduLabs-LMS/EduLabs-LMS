const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={},env={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:n=>n==='@/frontend/components/language-provider'?require('./localization-test-loader.cjs').language():n==='server-only'?{}:n in deps?deps[n]:require(n),process:{env},Buffer,Request,Response,URL,console});return module.exports;}
const contract=load('shared/contracts/communications.ts');
test('communication envelope rejects forged recipient, role and unknown fields',()=>{
 for(const extra of [{recipient:'other'},{role:'owner'},{isAdmin:true}])assert.equal(contract.communicationRequest.safeParse({domain:'support',action:'list',...extra}).success,false);
 for(const data of [{page:-1},{page:100001},{search:'x'.repeat(121)},{filter:'invalid'}])assert.throws(()=>contract.validateCommunication('support','list',data));
});
test('ticket body validates category, tenant UUID, length and required description',()=>{
 const valid={organizationId:null,category:'website',subject:'Problem',body:'Details'};
 assert.ok(contract.validateCommunication('support','create',valid));
 for(const value of [{...valid,organizationId:'bad'},{...valid,body:' '},{...valid,body:'x'.repeat(2001)},{...valid,category:'global-admin'},{...valid,recipient:'other'}])assert.throws(()=>contract.validateCommunication('support','create',value));
});
test('notification commands reject custom link and recipient injection',()=>{
 assert.throws(()=>contract.validateCommunication('notifications','emit',{recipient:'other'}));
 assert.throws(()=>contract.validateCommunication('notifications','preference',{event:'arbitrary',inApp:true,push:true}));
 assert.throws(()=>contract.validateCommunication('notifications','read',{id:'10000000-0000-0000-0000-000000000005',link:'https://evil.example'}));
});
test('all required notification events have informative labels',()=>{assert.equal(contract.notificationEvents.length,7);for(const event of contract.notificationEvents)assert.ok(contract.eventLabels[event].length>10);});
test('mobile header has one menu entry and delegates account notifications to the drawer sidebar',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const shell=({children})=>React.createElement('div',null,children);
 for(const firebase of [true,false]){
  const {MobileSidebar}=load('frontend/features/dashboard/mobile-sidebar.tsx',{
   '@/shared/auth-config':{isFirebaseStaging:()=>firebase},
   '@/frontend/components/providers/application-auth-provider':{useWebsiteNavigation:()=>({staffOrganizationIds:[]})},'@/shared/teacher-home':{showTeacherNav:()=>false,teacherHomeHref:'/home'},'@/frontend/components/brand-logo':{BrandLogo:({href})=>require('react').createElement(href?'a':'div',{'data-brand-logo':true,href},'EduLabs')},
   '@/frontend/features/notifications/notifications-view':{NotificationBell:()=>React.createElement('a',{href:'/notifications'},'Notifications')},
   '@/frontend/components/ui/sheet':{Sheet:shell,SheetContent:shell,SheetTrigger:({children,...props})=>React.createElement('button',props,children)},
   '@/frontend/components/sidebar':()=>React.createElement('div',null,firebase?'Account Notifications':'Account'),'@/frontend/components/edulabs-mark':()=>null,'lucide-react':{Menu:()=>null},
  });
  const html=renderToStaticMarkup(React.createElement(MobileSidebar));
  assert.equal(html.includes('Account Notifications'),firebase);
  assert.equal(html.includes('href="/notifications"'),false);
  assert.match(html,/Open Navigation Menu/);assert.match(html,/EduLabs/);
 }
});
function handler({viewer={backend:'firebase'},staging=true,call=async()=>({ok:true})}={}){
 return load('server/http/communications.ts',{'@/shared/auth-config':{isFirebaseStaging:()=>staging},'@/server/http/firebase/route':{validFirebaseOrigin:req=>req.headers.get('origin')==='http://localhost:3000'},'@/server/services/application-auth':{getApplicationViewer:async()=>viewer},'@/server/services/communications':{communicationService:async()=>call,communicationFailure:(message,status=400)=>Object.assign(Error(message),{status})},'@/shared/contracts/communications':contract},{LMS_DATA_BACKEND:'supabase-staging'}).communicationsPOST;
}
function request(value,origin='http://localhost:3000'){return new Request('http://localhost:3000/api/communications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(value)});}
test('communication endpoint enforces exact origin and verified Firebase viewer',async()=>{
 const value={domain:'notifications',action:'list'};
 assert.equal((await handler()(request(value,'https://evil.example'))).status,403);
 assert.equal((await handler({viewer:null})(request(value))).status,401);
 assert.equal((await handler({viewer:{backend:'clerk'}})(request(value))).status,401);
 assert.equal((await handler({staging:false})(request(value))).status,404);
});
test('communication endpoint rejects oversized bodies before RPC',async()=>{let calls=0;const r=await handler({call:async()=>{calls++;}})(request({domain:'support',action:'list',data:{search:'a'.repeat(17000)}}));assert.equal(r.status,413);assert.equal(calls,0);});
test('support mutations require idempotency key and ticket ID before RPC',async()=>{
 const value={domain:'support',action:'reply',data:{body:'Message'}};
 assert.equal((await handler()(request(value))).status,400);
 assert.equal((await handler()(request({...value,requestId:'10000000-0000-0000-0000-000000000005'}))).status,400);
});
test('validated requests reach scoped RPC adapter without credential or recipient injection',async()=>{
 let args;const response=await handler({call:async(...a)=>{args=a;return {rows:[]};}})(request({domain:'notifications',action:'list'}));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(args[0],'notifications');assert.equal(args[1],'list');assert.equal(args[2].page,0);
});
test('database denial, stale writes and failures remain explicit HTTP errors',async()=>{
 for(const status of [403,409,429,503]){const r=await handler({call:async()=>{throw Object.assign(Error('Scoped failure'),{status});}})(request({domain:'notifications',action:'list'}));assert.equal(r.status,status);}
});
test('push worker never reports provider rejection as successful delivery',async()=>{
 const {dispatch}=require('./notification-dispatch.cjs');const calls=[];
 const client={rpc:async(action,args)=>{calls.push(args);return {data:args.p_action==='claim'?[{id:'test',lease:'lease',endpoint:'https://fcm.googleapis.com/test',p256dh:'public',auth:'auth'}]:args.p_action==='check'?{valid:true}:{},error:null};}};
 const r=await dispatch(client,{sendNotification:async()=>{throw {statusCode:410};}});
 assert.deepEqual(r,{providerAccepted:0,notAccepted:1});assert.equal(calls[2].p_data.status,410);
});
test('Web Push library creates encrypted standards-based payload without exposing message plaintext',()=>{
 const crypto=require('node:crypto'),webpush=require('web-push');const client=crypto.createECDH('prime256v1');client.generateKeys();
 const vapid=webpush.generateVAPIDKeys();const payload='Private synthetic notification';
 const details=webpush.generateRequestDetails({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-only',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}},payload,{vapidDetails:{subject:'mailto:synthetic@example.invalid',publicKey:vapid.publicKey,privateKey:vapid.privateKey},TTL:60});
 assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.ok(Buffer.isBuffer(details.body));assert.equal(details.body.includes(Buffer.from(payload)),false);assert.ok(details.headers.Authorization||details.headers.authorization);
});
test('push accepted status and acknowledgement are both checked',async()=>{
 const {dispatch}=require('./notification-dispatch.cjs');let count=0;
 const client={rpc:async()=>++count===1?{data:[{id:'test',lease:'lease'}],error:null}:count===2?{data:{valid:true},error:null}:{data:null,error:{code:'XX000'}}};
 await assert.rejects(()=>dispatch(client,{sendNotification:async()=>({statusCode:201})}),/acknowledgement/);
});
test('cancelled claimed jobs are rechecked and skipped before contacting push provider',async()=>{
 const {dispatch}=require('./notification-dispatch.cjs');let sends=0;
 const result=await dispatch({rpc:async(_,v)=>v.p_action==='claim'?{data:[{id:'test',lease:'lease'}],error:null}:{data:{valid:false},error:null}},{sendNotification:async()=>{sends++;}});
 assert.equal(sends,0);assert.deepEqual(result,{providerAccepted:0,notAccepted:0,invalidated:1});
});
test('lease revocation during provider request is not falsely acknowledged as sent',async()=>{
 const {dispatch}=require('./notification-dispatch.cjs');
 const result=await dispatch({rpc:async(_,v)=>v.p_action==='claim'?{data:[{id:'test',lease:'lease'}],error:null}:v.p_action==='check'?{data:{valid:true},error:null}:{data:null,error:{code:'PT409'}}},{sendNotification:async()=>({statusCode:201})});
 assert.deepEqual(result,{providerAccepted:0,notAccepted:0,invalidated:1});
});
test('in-app reminder worker does not claim push jobs',async()=>{const {dispatch}=require('./notification-dispatch.cjs');let action;assert.deepEqual(await dispatch({rpc:async(_,v)=>{action=v.p_action;return {data:{ok:true},error:null};}},null,true),{swept:true});assert.equal(action,'sweep');});
test('service worker has no private cache, arbitrary navigation or token handling',()=>{const s=fs.readFileSync('public/edulabs-push-sw.js','utf8');assert.doesNotMatch(s,/addEventListener\('fetch'|caches\.|event\.data|Bearer|service.role/);assert.match(s,/new URL\('\/notifications', self.location.origin\)/);});
test('Firebase support and notifications routes require application authentication',()=>{for(const route of ['app/(dashboard)/(routes)/support/page.tsx','app/(dashboard)/(routes)/notifications/page.tsx'])assert.match(fs.readFileSync(route,'utf8'),/getApplicationViewer\(\)/);const routes=load('shared/website-routes.ts');assert.ok(routes.isPhaseOneRoute('/support'));assert.ok(routes.isPhaseOneRoute('/notifications'));});
test('support renders messages as escaped React text and displays real response deadlines',()=>{const source=fs.readFileSync('frontend/features/support/supabase-support-view.tsx','utf8');assert.match(source,/\{m.body\}/);assert.doesNotMatch(source,/dangerouslySetInnerHTML/);assert.match(source,/response_due_at/);assert.match(source,/overdue/);assert.match(source,/crypto.randomUUID\(\)/);});
test('notification permission is explicitly requested only by the enable action',()=>{const s=fs.readFileSync('frontend/features/notifications/notifications-view.tsx','utf8');assert.match(s,/async function push\(enable:boolean\)/);assert.match(s,/Notification.requestPermission\(\)/);assert.match(s,/onClick=\{\(\)=>void push\(true\)\}/);assert.match(s,/Browser push is not configured/);});
test('legacy email destinations are configured and interpolated HTML is escaped',()=>{const s=fs.readFileSync('server/http/support/route.ts','utf8');assert.doesNotMatch(s,/support\.lop\.physics@gmail|bodyahmedyehia902@gmail/);assert.match(s,/SUPPORT_EMAIL_TO/);assert.match(s,/escape\(message\)/);assert.match(s,/emailResult.error/);});

const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),vm=require('vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function footer(firebase){
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/components/footer.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require:name=>name==='@/frontend/components/language-provider'?require('./localization-test-loader.cjs').language():name==='@/shared/auth-config'?{isFirebaseStaging:()=>firebase}:name==='@/shared/constants/contact'?{TEACHER_CONTACT:{name:'Mrs. Ghada Ali',displayPhone:'01094683366',whatsappUrl:'https://wa.me/201094683366',phoneUrl:'tel:+201094683366'}}:name==='lucide-react'?{HelpCircle:()=>null,MessageCircle:()=>null,Phone:()=>null}:require(name)});
 return renderToStaticMarkup(React.createElement(module.exports.default));
}
test('Firebase footer enables real support and keeps unavailable teacher contacts disabled',()=>{
 const html=footer(true);assert.doesNotMatch(html,/Ghada|010946|wa\.me|tel:/);assert.match(html,/href="\/support"/);assert.doesNotMatch(html,/Help — soon/);assert.match(html,/authorized teacher/);assert.equal((html.match(/aria-disabled="true"/g)||[]).length,2);assert.equal((html.match(/tabindex="0"/g)||[]).length,3);assert.match(html,/Made by:/);assert.match(html,/Mohamed Tamer Mohamed/);
});
test('legacy footer keeps functional contact links and attribution',()=>{
 const html=footer(false);assert.match(html,/href="https:\/\/wa.me\/201094683366"/);assert.match(html,/href="tel:\+201094683366"/);assert.match(html,/href="\/support"/);assert.doesNotMatch(html,/aria-disabled="true"/);
});

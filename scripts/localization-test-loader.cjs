// Loads the real language resources/components in existing isolated TS unit tests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(source,{module:m,exports:m.exports,console,URL,Intl,setTimeout,clearTimeout,require:n=>{if(n.startsWith('@/')||n.startsWith('.')){const p=n.startsWith('@/')?path.resolve(n.slice(2)):path.resolve(path.dirname(file),n);return load(fs.existsSync(p+'.tsx')?p+'.tsx':p+'.ts');}return require(n);}});return m.exports;}
module.exports={load,language:()=>load('frontend/components/language-provider.tsx')};

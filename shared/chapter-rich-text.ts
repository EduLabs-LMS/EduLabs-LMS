export type ChapterTextNode={tag:string;children:(ChapterTextNode|string)[]};
const allowed=new Set(['p','br','strong','b','em','i','u','s','ol','ul','li','h1','h2','h3','blockquote']);
/** Restrictive Quill subset. No attributes, links, images, CSS or executable HTML. */
export function chapterRichText(value:string):(ChapterTextNode|string)[]{
 const root:ChapterTextNode={tag:'root',children:[]},stack=[root];
 const source=value.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 for(const token of source.split(/(<[^>]*>)/g)){
  const tag=token.match(/^<\s*(\/?)\s*([a-z0-9]+)\b[^>]*>$/i);
  if(tag){const name=tag[2].toLowerCase();if(!allowed.has(name))continue;
   if(tag[1]){const i=stack.map(n=>n.tag).lastIndexOf(name);if(i>0)stack.splice(i);}
   else {const node:ChapterTextNode={tag:name,children:[]};stack[stack.length-1].children.push(node);if(name!=='br'&&stack.length<30)stack.push(node);}
  }else if(token)stack[stack.length-1].children.push(token.replace(/&(nbsp|amp|lt|gt|quot|#39);/g,(_,e:string)=>({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[e]??'')));
 }
 return root.children;
}

import { createElement } from 'react';
import { chapterRichText,type ChapterTextNode } from '@/shared/chapter-rich-text';
export function ChapterDescription({value}:{value:string}){
 const render=(n:ChapterTextNode|string,index:number):React.ReactNode=>typeof n==='string'?n:createElement(n.tag,{key:index},...(n.tag==='br'?[]:n.children.map(render)));
 return <div className="prose prose-sm max-w-none whitespace-pre-wrap rounded-xl border-2 border-black bg-white p-4 text-slate-600">{chapterRichText(value).map(render)}</div>;
}

import Link from 'next/link';
import { Tree } from './tree';
import { T } from './preferences';
export function EduCourseCard({id,href,title,category,chaptersLength,progress}:{id:string;href?:string;title:string;category?:string;chaptersLength?:number;progress?:number|null}) {
  return <Link href={href || `/courses/${id}`} className="edu-card edu-course-card"><div className="edu-course-art" aria-hidden="true"><Tree variant="ink" /></div><div className="edu-course-info"><span className="edu-pill w-fit">{category || 'EduLabs'}</span><h3 className="text-xl">{title}</h3><p className="edu-muted text-sm">{chaptersLength===undefined ? <T arabic="عدد الفصول غير متاح">Chapter count unavailable</T> : <>{chaptersLength} <T arabic="فصول">chapters</T></>}</p>{progress!==null&&progress!==undefined&&<p>{progress}% <T arabic="مكتمل">completed</T></p>}</div></Link>;
}

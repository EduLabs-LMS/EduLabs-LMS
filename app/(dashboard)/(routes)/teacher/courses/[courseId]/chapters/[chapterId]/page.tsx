import { LearningPartPage } from '@/app/(dashboard)/_components/learning-part-page';
export default async function Page({params}:{params:Promise<{courseId:string;chapterId:string}>}){const p=await params;return <LearningPartPage courseId={p.courseId} segmentId={p.chapterId}/>;}

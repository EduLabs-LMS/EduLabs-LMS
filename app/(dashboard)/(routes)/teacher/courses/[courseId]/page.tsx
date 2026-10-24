import { TeacherEditor } from '@/app/(dashboard)/_components/teacher-editor';
export default async function Page({params}:{params:Promise<{courseId:string}>}){return <TeacherEditor courseId={(await params).courseId}/>;}

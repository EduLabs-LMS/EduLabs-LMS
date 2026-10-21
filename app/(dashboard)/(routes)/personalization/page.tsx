import { redirect } from 'next/navigation';
/** One settings interface; old bookmarks remain valid. Dashboard layout retains authentication. */
export default function PersonalizationPage(){redirect('/settings');}

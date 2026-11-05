import { L } from '@/frontend/components/language-provider';
import { PageSkeleton } from '@/frontend/components/skeleton';

export default function Loading() { return <PageSkeleton name="group-form" label={<L id="tg.loading" />} />; }

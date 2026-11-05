import { L } from '@/frontend/components/language-provider';
import { PageSkeleton } from '@/frontend/components/skeleton';

/** Settings pages keep the settings frame; only the content area shows this while a page is on its way. */
export default function Loading() { return <PageSkeleton name="settings" label={<L id="th.state.loading" />} />; }

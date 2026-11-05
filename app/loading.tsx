import { L } from '@/frontend/components/language-provider';
import { PageSkeleton } from '@/frontend/components/skeleton';

/**
 * The fallback for the whole app while a page that has no loading.tsx of its own is rendering (for example a full reload).
 * There is no overlay here: the logo overlay is only for the first load after sign-in (LoadingProvider.beginFirstLoad).
 */
const Loading = () => <PageSkeleton name="app" label={<L id="th.state.loading" />} />;

export default Loading;

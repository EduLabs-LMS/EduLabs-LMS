import RouteLoadingSignal from '@/frontend/components/route-loading-signal';
import { LearningLoadState } from '@/frontend/features/self-learning/continue-learning';
export default function Loading() { return <><RouteLoadingSignal /><LearningLoadState loading /></>; }

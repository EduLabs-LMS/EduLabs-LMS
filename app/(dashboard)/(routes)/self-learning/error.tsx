'use client';
import { LearningLoadState } from '@/frontend/features/self-learning/continue-learning';
export default function ErrorPage({ reset }: { reset: () => void }) { return <LearningLoadState retry={reset} />; }

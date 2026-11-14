'use client';
import type { LiveClassJoined } from '@/shared/live-class';

/** Who opened one Session's EduLabs class (the Group's staff only). A failure is null: the sheet works without it, nothing is pre-marked. */
export async function readJoined(sessionId: string, signal?: AbortSignal): Promise<LiveClassJoined | null> {
  try {
    const r = await fetch(`/api/live-class/joined?sessionId=${encodeURIComponent(sessionId)}`, { signal, cache: 'no-store' });
    if (!r.ok) return null;
    const v = await r.json() as LiveClassJoined;
    return v && Array.isArray(v.joined) && typeof v.liveClass === 'boolean' ? v : null;
  } catch { return null; }
}

import 'server-only';
import { NextResponse } from 'next/server';
// The legacy secure exam runner is retired (fix-01-direct-access, A6b-06): the legacy exam tables and functions have no client access, so every
// method answers 410 Gone. The old handler (server/http/exam-runner.ts) stays unreferenced until the legacy exam code is deleted (Track 10).
export function retiredRoute() {
  return NextResponse.json({ error: 'This exam route has been retired.' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}

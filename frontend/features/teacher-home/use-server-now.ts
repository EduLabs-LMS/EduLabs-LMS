'use client';
import { useEffect, useState } from 'react';
import { msToNextMinute, serverClockOffset, serverTimeFrom } from '@/shared/home-countdown';

// A page restored from the router's cache brings back an old "now". The offset from the moment this answer first arrived is still right, so it is kept for that answer.
let measured: { serverNow: string; offset: number } | null = null;
function offsetFor(serverNow: string) {
  if (measured?.serverNow !== serverNow) measured = { serverNow, offset: serverClockOffset(Date.parse(serverNow), Date.now()) };
  return measured.offset;
}

/**
 * The server's time, in the browser, updated once a minute and when the tab comes back. A wrong device clock does not matter, because only the time that has passed on it is used.
 * The first render is exactly the server's value, so the server's HTML and the browser agree.
 */
export function useServerNow(serverNow: string) {
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    const offset = offsetFor(serverNow);
    const read = () => serverTimeFrom(Date.now(), offset);
    let timer = 0;
    const tick = () => { const current = read(); setNow(current); window.clearTimeout(timer); timer = window.setTimeout(tick, msToNextMinute(current)); };
    const back = () => { if (document.visibilityState === 'visible') tick(); };
    tick();
    document.addEventListener('visibilitychange', back);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', back); };
  }, [serverNow]);
  return now;
}

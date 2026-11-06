'use client';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/frontend/components/language-provider';
import { countdownParts, formatCountdown, msToNextMinute } from '@/shared/home-countdown';

/** How long until it starts: a calm line that changes once a minute, in the time given (the server's, never the device's). */
export function Countdown({ startsAt, now, as: Tag = 'span' }: { startsAt: string; now: number; as?: 'span' | 'p' }) {
  const { language, number } = useLanguage();
  return <Tag data-countdown className="d-countdown"><bdi>{formatCountdown(countdownParts(Date.parse(startsAt), now), language, number)}</bdi></Tag>;
}

/** The server's time, moved on by the device's own clock once a minute. `skew` is how far the server's clock was from this device when it was read, so a wrong device clock changes nothing. */
export function useServerMinute(skew: number) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { const at = Date.now() + skew; setNow(at); timer = setTimeout(tick, msToNextMinute(at)); };
    tick();
    return () => clearTimeout(timer);
  }, [skew]);
  return now;
}

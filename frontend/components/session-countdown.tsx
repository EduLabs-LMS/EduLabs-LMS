'use client';

import { L, useLanguage } from '@/frontend/components/language-provider';
import { useState, useEffect } from 'react';
import { getRemainingTime, type RemainingTime } from '@/shared/countdown';
import { cn } from '@/shared/utils';

interface SessionCountdownProps {
    targetDate?: string | Date | null;
    endDate?: string | Date | null;
    serverNow?: string;
    className?: string;
}

export const SessionCountdown = ({ targetDate, endDate, serverNow, className }: SessionCountdownProps) => {
    const { ui } = useLanguage();
    const target = targetDate ? new Date(targetDate).getTime() : NaN;
    const end = endDate ? new Date(endDate).getTime() : NaN;
    const [sessionEnded,setSessionEnded] = useState(false);
    const [countdown, setCountdown] = useState<{
        target: number;
        remaining: RemainingTime | null;
    } | null>(null);

    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined;
        const base = Date.now();
        const server = serverNow ? Date.parse(serverNow) : base;
        const update = () => {
            const now = Number.isFinite(server) ? server + Date.now() - base : Date.now();
            const remaining = getRemainingTime(target, now);
            setSessionEnded(Number.isFinite(end) && now >= end);
            setCountdown({ target, remaining });
            if (!remaining || (remaining.hasStarted && !Number.isFinite(end))) {
                if (interval) clearInterval(interval);
                return false;
            }
            return true;
        };
        if (update()) interval = setInterval(update, 1000);
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [target,end,serverNow]);

    const timeLeft = countdown?.target === target ? countdown.remaining : null;
    const units = [
        { key: 'days', label: 'Days' },
        { key: 'hours', label: 'Hours' },
        { key: 'minutes', label: 'Minutes' },
        { key: 'seconds', label: 'Seconds' },
    ] as const;

    return (
        <div className={cn('w-full min-w-0 max-w-sm space-y-2.5', className)}>
            <p className="text-xs font-medium text-slate-500">
                <L text={sessionEnded ? 'Session completed' : timeLeft?.hasStarted ? (endDate ? 'In Progress' : 'Scheduled start time reached') : 'Class starts in'}/>
            </p>
            <div role="timer" aria-label={ui('Time until your next class')} aria-live="off" className="grid grid-cols-4 gap-2 sm:gap-3">
                {units.map(({ key, label }) => (
                    <div key={key} className={cn(
                        'flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-3 sm:min-h-[88px]',
                        key === 'seconds' ? 'border-sky-100 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-900'
                    )}>
                        <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-3xl">
                            {timeLeft ? String(timeLeft[key]).padStart(2, '0') : '--'}
                        </span>
                        <span className="text-[10px] font-medium text-slate-500 sm:text-xs"><L text={label}/></span>
                    </div>
                ))}
            </div>
            {!Number.isFinite(target) && <p className="text-xs text-slate-500"><L id="countdown.unavailable"/></p>}
        </div>
    );
};

export default SessionCountdown;

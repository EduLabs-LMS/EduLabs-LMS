import { L } from '@/frontend/components/language-provider';
import { type TicketStatus } from '@/shared/support';
import { cn } from '@/shared/utils';

// Amber = needs attention, blue = being handled, green = done. All map onto the dark-mode layer.
const STATUS_CLASS: Record<TicketStatus, string> = {
	OPEN: 'bg-amber-200 text-amber-900',
	IN_PROGRESS: 'bg-sky-200 text-sky-900',
	RESOLVED: 'bg-primary text-primary-foreground',
};

export const StatusBadge = ({ status, className }: { status: TicketStatus; className?: string }) => (
	<span
		className={cn(
			'inline-flex items-center rounded-full border-2 border-black px-3 py-1 text-[11px] font-bold uppercase leading-none tracking-wide',
			STATUS_CLASS[status],
			className
		)}
	>
		<L id={status==='OPEN'?'support.open':status==='IN_PROGRESS'?'support.inProgress':'support.resolved'}/>
	</span>
);

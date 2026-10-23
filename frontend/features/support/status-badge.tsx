import { L } from '@/frontend/components/language-provider';
import { STATUS_LABEL, type TicketStatus } from '@/shared/support';
import { cn } from '@/shared/utils';

const STATUS_CLASS: Record<TicketStatus, string> = {
	OPEN: 'bg-amber-200',
	IN_PROGRESS: 'bg-sky-200',
	RESOLVED: 'bg-primary',
};

export const StatusBadge = ({ status, className }: { status: TicketStatus; className?: string }) => (
	<span
		className={cn(
			'inline-flex items-center rounded-full border-2 border-black px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
			STATUS_CLASS[status],
			className
		)}
	>
		<L id={status==='OPEN'?'support.open':status==='IN_PROGRESS'?'support.inProgress':'support.resolved'}/>
	</span>
);

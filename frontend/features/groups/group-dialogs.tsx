'use client';
import { L } from '@/frontend/components/language-provider';
import { useEffect, useState } from 'react';
import type { MessageKey } from '@/frontend/locales/messages';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/frontend/components/ui/dialog';

const field = 'min-h-[44px] w-full rounded-xl border-2 border-black bg-white p-3 text-sm';
const btn = 'min-h-[44px] rounded-full border-2 border-black px-5 text-sm font-bold shadow-hard-sm disabled:opacity-50';

/** Asks for a reason (and optionally another choice) before an action that is hard to take back. */
export function ReasonDialog({ open, title, body, required, children, canConfirm = true, onConfirm, onCancel }: { open: boolean; title: MessageKey; body: MessageKey; required: boolean; children?: React.ReactNode; canConfirm?: boolean; onConfirm: (reason: string) => void; onCancel: () => void }) {
	const [reason, setReason] = useState('');
	useEffect(() => { if (open) setReason(''); }, [open]);
	const ok = canConfirm && (!required || reason.trim().length >= 3);
	return (
		<Dialog open={open} onOpenChange={value => { if (!value) onCancel(); }}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="font-display text-2xl"><L id={title} /></DialogTitle>
					<DialogDescription><L id={body} /></DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					{children}
					<label className="block text-sm font-semibold"><L id={required ? 'gv.reason_required' : 'gv.reason_optional'} /><input className={field + ' mt-1 font-normal'} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
				</div>
				<DialogFooter className="gap-2">
					<button type="button" className={btn + ' bg-white'} onClick={onCancel}><L id="gv.cancel" /></button>
					<button type="button" className={btn + ' bg-primary'} disabled={!ok} onClick={() => onConfirm(reason.trim())}><L id="users.confirm" /></button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

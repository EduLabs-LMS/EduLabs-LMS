'use client';
import { L } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/frontend/components/ui/alert-dialog';

/** Asks before an action that is hard to take back. Nothing happens until the person confirms. */
export function ConfirmDialog({ open, title, body, onConfirm, onCancel }: { open: boolean; title: MessageKey; body: MessageKey; onConfirm: () => void; onCancel: () => void }) {
	return (
		<AlertDialog open={open} onOpenChange={value => { if (!value) onCancel(); }}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="font-display text-2xl"><L id={title} /></AlertDialogTitle>
					<AlertDialogDescription><L id={body} /></AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel className="min-h-[44px]"><L id="users.cancel" /></AlertDialogCancel>
					<AlertDialogAction className="min-h-[44px]" onClick={onConfirm}><L id="users.confirm" /></AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

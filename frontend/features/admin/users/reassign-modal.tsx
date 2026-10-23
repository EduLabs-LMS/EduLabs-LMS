'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useState } from 'react';
import { api } from '@/frontend/lib/api';
import { Loader2, Users } from 'lucide-react';
import toast from 'react-hot-toast';

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { Button } from '@/frontend/components/ui/button';

interface ReassignModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
	student: {
		id: string;
		name: string;
		email?: string;
	} | null;
	groups: Array<{
		id: string;
		name: string;
	}>;
	currentGroupId?: string | null;
}

export const ReassignModal = ({
	isOpen,
	onClose,
	onSuccess,
	student,
	groups,
	currentGroupId,
}: ReassignModalProps) => {
	const [selectedGroupId, setSelectedGroupId] = useState<string>(
		currentGroupId || (groups[0]?.id ?? '')
	);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleAssign = async () => {
		if (!student?.id || !selectedGroupId) return;

		try {
			setIsSubmitting(true);
			await api.put('/api/admin/groups', {
				userId: student.id,
				groupId: selectedGroupId,
			});
			toast.success(`Assigned ${student.name} to group successfully!`);
			onSuccess();
			onClose();
		} catch (error) {
			console.error(error);
			toast.error('Failed to assign student to group.');
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleUnassign = async () => {
		if (!student?.id) return;

		try {
			setIsSubmitting(true);
			await api.delete(`/api/admin/groups?userId=${student.id}`);
			toast.success(`Removed ${student.name} from group.`);
			onSuccess();
			onClose();
		} catch (error) {
			console.error(error);
			toast.error('Failed to remove student from group.');
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-md border-slate-200 bg-white text-slate-900 shadow-2xl rounded-2xl p-6">
				<DialogHeader>
					<div className="flex items-center gap-2 text-green-900 font-semibold text-xs uppercase tracking-wider mb-1">
						<Users className="h-4 w-4" />
						Group Assignment
					</div>
					<DialogTitle className="text-lg font-bold text-slate-900">
						Assign {student?.name || 'Student'}
					</DialogTitle>
					<DialogDescription className="text-xs text-slate-500">
						Move this student to a different study group or unassign them.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="space-y-1.5">
						<label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
							Select Target Group
						</label>
						<Dropdown
							value={selectedGroupId}
							onChange={(e) => setSelectedGroupId(e.target.value)}
							className="h-10 w-full rounded-xl border-2 border-black bg-slate-50 px-3 text-sm font-medium text-slate-900 outline-none focus:bg-white focus:ring-1 focus:ring-black"
						>
							{groups.map((g) => (
								<option key={g.id} value={g.id}>
									{g.name}
								</option>
							))}
						</Dropdown>
					</div>
				</div>

				<DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
					{currentGroupId && (
						<Button
							type="button"
							variant="outline"
							onClick={handleUnassign}
							disabled={isSubmitting}
							className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
						>
							Unassign from Group
						</Button>
					)}
					<div className="flex items-center gap-2 ml-auto">
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							className="border-slate-200 text-slate-700 hover:bg-slate-100"
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={handleAssign}
							disabled={isSubmitting || !selectedGroupId}
							className="bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-xs"
						>
							{isSubmitting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								'Save Assignment'
							)}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

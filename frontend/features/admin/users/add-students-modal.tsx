'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/frontend/lib/api';
import {
	Check,
	CheckCircle2,
	Loader2,
	Plus,
	Search,
	UserPlus,
	Users,
	X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { Input } from '@/frontend/components/ui/input';
import { Button } from '@/frontend/components/ui/button';
import { cn } from '@/shared/utils';

interface StudentItem {
	id: string;
	name: string;
	email: string;
	imageUrl?: string;
	role: string;
	currentGroup: { id: string; name: string } | null;
}

interface AddStudentsModalProps {
	group: { id: string; name: string } | null;
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
	currentMemberIds: string[];
}

export const AddStudentsModal = ({
	group,
	isOpen,
	onClose,
	onSuccess,
	currentMemberIds,
}: AddStudentsModalProps) => {
	const [students, setStudents] = useState<StudentItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [actionStudentId, setActionStudentId] = useState<string | null>(null);

	useEffect(() => {
		if (isOpen) {
			setIsLoading(true);
			setSelectedIds({});
			setSearchQuery('');
			api
				.get('/api/admin/students')
				.then((res) => {
					setStudents(res.data || []);
				})
				.catch((err) => {
					console.error(err);
					toast.error('Failed to load students.');
				})
				.finally(() => {
					setIsLoading(false);
				});
		}
	}, [isOpen]);

	const availableStudents = useMemo(() => {
		const memberSet = new Set(currentMemberIds);
		return students.filter((s) => !memberSet.has(s.id));
	}, [students, currentMemberIds]);

	const filteredStudents = useMemo(() => {
		if (!searchQuery.trim()) return availableStudents;
		const q = searchQuery.toLowerCase();
		return availableStudents.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.email.toLowerCase().includes(q) ||
				s.currentGroup?.name.toLowerCase().includes(q)
		);
	}, [availableStudents, searchQuery]);

	const handleAddSingle = async (student: StudentItem) => {
		if (!group) return;
		try {
			setActionStudentId(student.id);
			await api.put('/api/admin/groups', {
				userId: student.id,
				groupId: group.id,
			});
			toast.success(`Added ${student.name} to ${group.name}!`);
			onSuccess();
		} catch (error) {
			console.error(error);
			toast.error(`Failed to add ${student.name}.`);
		} finally {
			setActionStudentId(null);
		}
	};

	const toggleSelect = (studentId: string) => {
		setSelectedIds((prev) => ({
			...prev,
			[studentId]: !prev[studentId],
		}));
	};

	const selectedCount = Object.values(selectedIds).filter(Boolean).length;

	const handleAddSelected = async () => {
		if (!group || selectedCount === 0) return;
		try {
			setIsSubmitting(true);
			const targetIds = Object.keys(selectedIds).filter((id) => selectedIds[id]);

			for (const userId of targetIds) {
				await api.put('/api/admin/groups', {
					userId,
					groupId: group.id,
				});
			}

			toast.success(`Successfully added ${selectedCount} students to ${group.name}!`);
			onSuccess();
			onClose();
		} catch (error) {
			console.error(error);
			toast.error('Failed to add some students.');
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-xl border-slate-200 bg-white text-slate-900 shadow-2xl rounded-2xl p-6">
				<DialogHeader>
					<div className="flex items-center gap-2 text-green-900 font-semibold text-xs uppercase tracking-wider mb-1">
						<UserPlus className="h-4 w-4" />
						Add Students to Group
					</div>
					<DialogTitle className="text-xl font-bold text-slate-900">
						Add to {group?.name || 'Study Group'}
					</DialogTitle>
					<DialogDescription className="text-xs text-slate-500">
						Select enrolled students to assign them directly to this group.
					</DialogDescription>
				</DialogHeader>

				{/* Search Bar */}
				<div className="mt-3 relative">
					<Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
					<Input
						placeholder="Search by student name or email..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-9 h-10 text-xs border-slate-200 bg-slate-50 focus:bg-white"
					/>
				</div>

				{/* Student List */}
				<div className="mt-3 min-h-[250px] max-h-[360px] overflow-y-auto space-y-2 pr-1">
					{isLoading ? (
						<div className="flex min-h-[240px] items-center justify-center">
							<Loader2 className="h-6 w-6 animate-spin text-green-900" />
						</div>
					) : filteredStudents.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
							<Users className="h-8 w-8 text-slate-300 mb-2" />
							<p className="text-xs font-semibold text-slate-700">
								{availableStudents.length === 0
									? 'All enrolled students are already in this group!'
									: 'No students match your search.'}
							</p>
						</div>
					) : (
						filteredStudents.map((student) => {
							const isChecked = !!selectedIds[student.id];
							const isActionLoading = actionStudentId === student.id;

							return (
								<div
									key={student.id}
									className={cn(
										'flex items-center justify-between p-3 rounded-xl border transition-all',
										isChecked
											? 'border-slate-300 bg-green-50/50'
											: 'border-slate-200 bg-white hover:border-slate-300'
									)}
								>
									<div
										onClick={() => toggleSelect(student.id)}
										className="flex items-center gap-3 min-w-0 cursor-pointer select-none flex-1"
									>
										<input
											type="checkbox"
											checked={isChecked}
											onChange={() => toggleSelect(student.id)}
											className="h-4 w-4 rounded border-slate-300 text-green-900 focus:ring-black"
										/>
										{student.imageUrl ? (
											<img
												src={student.imageUrl}
												alt={student.name}
												className="h-8 w-8 rounded-full border-2 border-black object-cover shrink-0"
											/>
										) : (
											<div className="grid h-8 w-8 place-items-center rounded-full bg-green-100 text-green-900 font-bold text-xs shrink-0">
												{student.name.charAt(0)}
											</div>
										)}
										<div className="min-w-0 space-y-0.5">
											<p className="text-xs font-bold text-slate-900 truncate">
												{student.name}
											</p>
											<div className="flex items-center gap-2">
												<span className="text-[11px] text-slate-400 font-mono truncate">
													{student.email}
												</span>
												{student.currentGroup ? (
													<span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-600 shrink-0">
														in {student.currentGroup.name}
													</span>
												) : (
													<span className="rounded-full bg-green-50 px-1.5 py-0.2 text-[10px] font-semibold text-green-900 shrink-0">
														Unassigned
													</span>
												)}
											</div>
										</div>
									</div>

									<Button
										size="sm"
										variant="outline"
										disabled={isActionLoading}
										onClick={() => handleAddSingle(student)}
										className="h-7 text-xs border-slate-200 hover:bg-slate-100 ml-2 shrink-0 font-medium"
									>
										{isActionLoading ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											<>
												<Plus className="h-3 w-3 mr-1" />
												Add
											</>
										)}
									</Button>
								</div>
							);
						})
					)}
				</div>

				<DialogFooter className="pt-3 border-t border-slate-100 flex flex-col-reverse sm:flex-row gap-2 justify-between items-center">
					<div className="text-xs text-slate-500">
						{selectedCount > 0
							? `${selectedCount} student${selectedCount === 1 ? '' : 's'} selected`
							: `${availableStudents.length} available students`}
					</div>

					<div className="flex items-center gap-2 w-full sm:w-auto">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={onClose}
							className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs"
						>
							Done
						</Button>

						{selectedCount > 0 && (
							<Button
								type="button"
								size="sm"
								disabled={isSubmitting}
								onClick={handleAddSelected}
								className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs"
							>
								{isSubmitting ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
								) : (
									<UserPlus className="h-3.5 w-3.5 mr-1.5" />
								)}
								Add Selected ({selectedCount})
							</Button>
						)}
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

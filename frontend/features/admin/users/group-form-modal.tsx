'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/lib/api';
import { Calendar, Clock, Loader2, Plus, Trash2, Users } from 'lucide-react';
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

const WEEKDAYS = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
] as const;

export interface SessionScheduleItem {
	day: string;
	time: string;
}

export interface GroupItem {
	id: string;
	name: string;
	schedule: any;
	students?: any[];
}

interface GroupFormModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
	initialGroup?: GroupItem | null;
}

export const GroupFormModal = ({
	isOpen,
	onClose,
	onSuccess,
	initialGroup,
}: GroupFormModalProps) => {
	const [name, setName] = useState('');
	const [sessions, setSessions] = useState<SessionScheduleItem[]>([
		{ day: 'Monday', time: '16:00' },
		{ day: 'Thursday', time: '14:00' },
	]);
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		if (initialGroup) {
			setName(initialGroup.name);
			if (Array.isArray(initialGroup.schedule) && initialGroup.schedule.length > 0) {
				setSessions(
					initialGroup.schedule.map((s: any) => ({
						day: s.day || 'Monday',
						time: s.time || '16:00',
					}))
				);
			} else {
				setSessions([
					{ day: 'Monday', time: '16:00' },
					{ day: 'Thursday', time: '14:00' },
				]);
			}
		} else {
			setName('');
			setSessions([
				{ day: 'Monday', time: '16:00' },
				{ day: 'Thursday', time: '14:00' },
			]);
		}
	}, [initialGroup, isOpen]);

	const addSession = () => {
		setSessions((prev) => [...prev, { day: 'Tuesday', time: '16:00' }]);
	};

	const removeSession = (index: number) => {
		if (sessions.length <= 1) {
			toast.error('Groups must have at least one session.');
			return;
		}
		setSessions((prev) => prev.filter((_, i) => i !== index));
	};

	const updateSession = (
		index: number,
		field: keyof SessionScheduleItem,
		value: string
	) => {
		setSessions((prev) =>
			prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
		);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) {
			toast.error('Please enter a group name.');
			return;
		}

		try {
			setIsSubmitting(true);
			if (initialGroup) {
				await api.patch('/api/admin/groups', {
					id: initialGroup.id,
					name: name.trim(),
					schedule: sessions,
				});
				toast.success('Group updated successfully!');
			} else {
				await api.post('/api/admin/groups', {
					name: name.trim(),
					schedule: sessions,
				});
				toast.success('Group created successfully!');
			}
			onSuccess();
			onClose();
		} catch (error: any) {
			console.error(error);
			const message = error?.response?.data;
			toast.error(
				typeof message === 'string' && message
					? message
					: 'Failed to save group. Please try again.'
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-lg border-slate-200 bg-white text-slate-900 shadow-2xl rounded-2xl p-6">
				<DialogHeader>
					<div className="flex items-center gap-2 text-sky-700 font-semibold text-xs uppercase tracking-wider mb-1">
						<Users className="h-4 w-4" />
						{initialGroup ? 'Edit Study Group' : 'Create Study Group'}
					</div>
					<DialogTitle className="text-xl font-bold text-slate-900">
						{initialGroup ? `Configure ${initialGroup.name}` : 'New Study Group'}
					</DialogTitle>
					<DialogDescription className="text-xs text-slate-500">
						Define group naming and multi-session recurring weekly meeting times.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-5 mt-3">
					<div className="space-y-1.5">
						<label
							htmlFor="group-name"
							className="text-xs font-semibold uppercase tracking-wider text-slate-700"
						>
							Group Name
						</label>
						<Input
							id="group-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Group A - Advanced"
							required
							className="border-slate-200 bg-slate-50 text-slate-900 focus:bg-white"
						/>
					</div>

					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
								Weekly Session Schedule
							</label>
							<button
								type="button"
								onClick={addSession}
								className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800 transition cursor-pointer"
							>
								<Plus className="h-3.5 w-3.5" />
								Add Session
							</button>
						</div>

						<div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
							{sessions.map((session, index) => (
								<div
									key={index}
									className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3"
								>
									<span className="text-xs font-bold text-slate-400 w-16 shrink-0">
										Session {index + 1}:
									</span>

									{/* Day Dropdown */}
									<Dropdown
										value={session.day}
										onChange={(e) => updateSession(index, 'day', e.target.value)}
										className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-sky-500"
									>
										{WEEKDAYS.map((day) => (
											<option key={day} value={day}>
												{day}
											</option>
										))}
									</Dropdown>

									{/* Time Picker / Input */}
									<div className="flex items-center gap-1.5 flex-1">
										<Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
										<Input
											type="time"
											value={session.time}
											onChange={(e) => updateSession(index, 'time', e.target.value)}
											required
											className="h-9 border-slate-200 bg-white text-xs font-medium text-slate-900"
										/>
									</div>

									{sessions.length > 1 && (
										<button
											type="button"
											onClick={() => removeSession(index)}
											className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									)}
								</div>
							))}
						</div>
					</div>

					<DialogFooter className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							className="border-slate-200 text-slate-700 hover:bg-slate-100"
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={isSubmitting}
							className="bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-xs"
						>
							{isSubmitting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : initialGroup ? (
								'Save Changes'
							) : (
								'Create Group'
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

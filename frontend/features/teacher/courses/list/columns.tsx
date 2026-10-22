'use client';
import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';

import { Button } from '@/frontend/components/ui/button';
import type { Course } from '@/shared/contracts/courses';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, MoreHorizontal, Pencil } from 'lucide-react';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/frontend/components/ui/dropdown-menu';
import Link from 'next/link';
import { Badge } from '@/frontend/components/ui/badge';
import { cn } from '@/shared/utils';

const CourseEditLink = ({ id }: { id: string }) => {
	const courseBase = useCourseManagementPath();
	return (
		<Link href={`${courseBase}/${id}`}>
							<DropdownMenuItem>
								<Pencil className="h-4 w-4 mr-2" />
								Edit
							</DropdownMenuItem>
						</Link>
	);
};

export type CourseListRow = Pick<Course, 'id' | 'title' | 'isPublished'>;
export const columns: ColumnDef<CourseListRow>[] = [
	{
		accessorKey: 'title',
		header: ({ column }) => {
			return (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
				>
					Title
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
	},
	{
		accessorKey: 'isPublished',
		header: ({ column }) => {
			return (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
				>
					Published
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
		cell: ({ row }) => {
			const isPublished = row.getValue('isPublished') || false;

			return (
				<Badge className={cn('bg-slate-500', isPublished && 'bg-sky-700')}>
					{isPublished ? 'Published' : 'Draft'}
				</Badge>
			);
		},
	},
	{
		id: 'actions',
		cell: ({ row }) => {
			const { id } = row.original;

			return (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant={'ghost'} className="h-4 w-8 p-0">
							<span className="sr-only">Open menu</span>

							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>

					<DropdownMenuContent>
						<CourseEditLink id={id} />
					</DropdownMenuContent>
				</DropdownMenu>
			);
		},
	},
];

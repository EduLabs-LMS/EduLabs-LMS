import Image from 'next/image';
import Link from 'next/link';
import { IconBadge } from '@/frontend/components/icon-badge';
import { BookOpen } from 'lucide-react';
import CourseProgress from '@/frontend/components/course-progress';

interface CourseCardProps {
	href?: string;
	id: string;
	title: string;
	imageUrl?: string | null;
	chaptersLength?: number;
	progress?: number | null;
	category?: string;
}

const CourseCard = ({
	href,
	id,
	title,
	imageUrl,
	chaptersLength,
	progress,
	category,
}: CourseCardProps) => {
	return (
		<Link href={href ?? `/courses/${id}`}>
			<div className="group hover:shadow-sm transition overflow-hidden border rounded-lg p-3 h-full">
				<div className="relative w-full aspect-video rounded-md overflow-hidden">
					{imageUrl ? (
						<Image fill className="object-cover" alt={title} src={imageUrl} />
					) : (
						<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-physics-charcoal to-physics-black text-physics-cyan">
							<BookOpen className="h-8 w-8" />
							<span className="text-xs font-medium">EduLabs</span>
						</div>
					)}
				</div>

				<div className="flex flex-col pt-2">
					<div className="text-lg md:text-base font-medium group-hover:text-green-900 transition line-clamp-2">
						{title}
					</div>

					<p className="text-xs text-muted-foreground">{category}</p>

					<div className="my-3 flex items-center gap-x-2 text-sm md:text-xs">
						<div className="flex items-center gap-x-1 text-slate-500">
							<IconBadge size={'sm'} icon={BookOpen} />

							<span>
								{`${chaptersLength} ${
									chaptersLength === 1 ? 'chapter' : 'chapters'
								}`}
							</span>
						</div>
					</div>

					{progress !== null && progress !== undefined && (
						<CourseProgress
							variant={progress === 100 ? 'success' : 'default'}
							value={progress}
							size="sm"
						/>
					)}
				</div>
			</div>
		</Link>
	);
};

export default CourseCard;

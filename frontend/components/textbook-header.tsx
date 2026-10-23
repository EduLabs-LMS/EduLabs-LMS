'use client';

import EduLabsMark from '@/frontend/components/edulabs-mark';
import Link from 'next/link';
import MobileSidebar from '@/frontend/features/dashboard/mobile-sidebar';
import { HelpCircle } from 'lucide-react';
import { HeaderTopRightWaves } from '@/frontend/components/textbook-frame';

const TextbookHeader = () => {

	return (
		<header className="fixed top-0 left-0 right-0 h-24 z-40 bg-white border-b-[2.5px] border-black text-black flex items-center justify-between px-4 sm:px-6 relative select-none w-full">
			{/* Multi-layered Vector Waves in Top-Right Corner */}
			<HeaderTopRightWaves />

			{/* Left Section: Mobile Menu Toggle (< md) + Desktop Contact/Author Pills (offset past sidebar w-64) */}
			<div className="flex items-center gap-3 pl-0 md:pl-68 relative z-20">
				{/* Mobile Drawer Trigger (Hidden on Desktop) */}
				<MobileSidebar />

				{/* Two Cyan Contact / Author Pills with Cyan Circle Badges (1:1 with Template lines 160-161) */}
				<div className="hidden sm:flex flex-col gap-1.5 py-0.5">
					{/* Pill 1: Phone Contact */}
					<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 border-2 border-black text-black shadow-hard-sm backdrop-blur-xs">
						<svg
							viewBox="0 0 30 30"
							className="h-4 w-4 shrink-0"
							aria-hidden="true"
						>
							<circle cx="15" cy="15" r="15" fill="#00A3C7" />
							<path
								d="M11.2 7.3c1-1 2.5-.8 3.3.2l1.3 1.5c.4.5.4 1.2.1 1.7l-.8 1c.8 1.3 1.8 2.4 3.1 3.1l1-.8c.5-.3 1.2-.3 1.7.1l1.5 1.3c1 .8 1.2 2.3.2 3.3l-.7.7c-.6.6-1.5.9-2.3.8-2.7-.5-5.1-1.8-7-3.7-1.9-1.9-3.2-4.3-3.7-7-.2-.9.1-1.7.8-2.3Z"
								fill="#fff"
							/>
						</svg>
						<span className="text-[11px] font-semibold text-black tracking-wide">
							Mrs. Ghada Ali: <span className="text-slate-700 font-mono font-bold">01094683366</span>
						</span>
					</div>

					{/* Pill 2: Author Credit */}
					<div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 border-2 border-black text-black shadow-hard-sm backdrop-blur-xs">
						<svg
							viewBox="0 0 30 30"
							className="h-4 w-4 shrink-0"
							aria-hidden="true"
						>
							<circle cx="15" cy="15" r="15" fill="#00A3C7" />
							<text
								x="15"
								y="18.4"
								fill="#fff"
								fontFamily="Arial, sans-serif"
								fontSize="9.4"
								fontWeight="800"
								textAnchor="middle"
							>
								By:
							</text>
						</svg>
						<span className="text-[11px] font-medium text-slate-700 tracking-wide">
							Mohamed Ahmed Yehia
						</span>
					</div>
				</div>
			</div>

			{/* Center Section: Hanging U-Shaped Crest */}
			<div className="absolute left-1/2 top-0 -translate-x-1/2 z-30 flex flex-col items-center pointer-events-auto">
				<Link
					href="/home"
					className="group relative flex flex-col items-center justify-center pt-2 pb-3 px-6 sm:px-8 bg-white border-x-[2.5px] border-b-[2.5px] border-black rounded-b-[38px] shadow-hard transition-transform duration-150 active:scale-95"
					>
					{/* Atomic Crest Logo */}
					<div className="relative h-11 w-11 sm:h-13 sm:w-13 flex items-center justify-center -mt-0.5">
						<EduLabsMark className="h-full w-full transition-transform duration-200 group-hover:scale-105" />
					</div>

					{/* Crest Title */}
					<span className="font-display text-lg sm:text-xl text-black leading-none mt-1">
						EduLabs
					</span>

					{/* Learning Platform Badge */}
					<span className="mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-primary text-black border-2 border-black tracking-wider leading-none shadow-hard-sm">
						Learning Platform
					</span>
				</Link>
			</div>

			{/* Right Section: Support Action */}
			<div className="flex items-center gap-2 relative z-20">
				<Link
					href="/support"
					className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold transition cursor-pointer active:scale-95 shadow-sm"
					title="Open a support ticket for login, video, or upload problems"
				>
					<HelpCircle className="h-4 w-4 text-cyan-400" />
					<span>Support</span>
				</Link>
			</div>
		</header>
	);
};

export default TextbookHeader;

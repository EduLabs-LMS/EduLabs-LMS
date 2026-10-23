'use client';

import { UserButton } from '@/frontend/components/providers/v2-identity';

const NavbarRoutes = () => {
	return (
		<div className="ml-auto flex items-center">
			<UserButton
				showName={true}
				appearance={{
					elements: {
						rootBox: 'flex items-center',
						userButtonBox: 'flex-row-reverse gap-2.5',
						userButtonOuterIdentifier: 'font-semibold text-slate-700 text-sm',
						avatarBox: 'h-9 w-9 border-2 border-black',
					},
				}}
			/>
		</div>
	);
};

export default NavbarRoutes;

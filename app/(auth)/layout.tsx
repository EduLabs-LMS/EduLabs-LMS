import EduLabsMark from '@/frontend/components/edulabs-mark';
import { isFirebaseStaging } from '@/shared/auth-config';

const AuthLayout = ({ children }: { children: React.ReactNode }) => {
	if(isFirebaseStaging())return <div className="flex min-h-full items-center justify-center p-4 py-8 sm:p-8">{children}</div>;
	return (
		<div className="min-h-full flex flex-col items-center justify-center gap-6 p-4">
			<div className="flex items-center gap-3">
				<EduLabsMark grow className="h-12 w-12" />
				<span className="font-display text-4xl leading-none text-black">EduLabs</span>
			</div>
			{children}
		</div>
	);
};

export default AuthLayout;

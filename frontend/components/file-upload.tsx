'use client';

import type { OurFileRouter } from '@/shared/contracts/uploads';
import { UploadDropzone } from '@/frontend/lib/uploadthing';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';
import { isFirebaseStaging } from '@/shared/auth-config';
import toast from 'react-hot-toast';

interface FileUploadProps {
	onChange: (url?: string, metadata?: { size?: number; key?: string; name?: string }) => Promise<void> | void;
	endpoint: keyof OurFileRouter | "examAnswerImage";
}

const FileUpload = ({ onChange, endpoint }: FileUploadProps) => {
	const { startLoading, stopLoading } = useGlobalLoading();

	if (isFirebaseStaging() || endpoint === "examAnswerImage") return <p role="status">Uploads are awaiting a Supabase Storage integration.</p>;
	return (
		<UploadDropzone
			appearance={{
				container: 'rounded-md border-2 border-black bg-white',
				uploadIcon: 'text-slate-950',
				label: 'text-slate-700',
				allowedContent: 'text-slate-500',
				button: 'bg-slate-950 text-white hover:bg-slate-800',
			}}
			endpoint={endpoint}
			onBeforeUploadBegin={(files) => {
				startLoading();
				return files;
			}}
			onClientUploadComplete={async (res) => {
				const file = res?.[0];
				const fileUrl = file?.url;

				if (!fileUrl) {
					toast.error('Upload completed without a file URL. Please try again.');
					stopLoading();
					return;
				}

				try {
					await onChange(fileUrl, { size: file?.size, key: file?.key, name: file?.name });
				} finally {
					stopLoading();
				}
			}}
			onUploadError={(error: Error) => {
				toast.error(error.message);
				stopLoading();
			}}
			onUploadAborted={stopLoading}
		/>
	);
};

export default FileUpload;

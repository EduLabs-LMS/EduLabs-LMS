const buf = require('buffer');
if (!buf.SlowBuffer) {
	buf.SlowBuffer = buf.Buffer;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.EDULABS_STANDALONE === '1' ? { output: 'standalone', experimental: { cpus: 2 } } : {}),
	...(process.env.EDULABS_DIST_DIR ? { distDir: process.env.EDULABS_DIST_DIR } : {}),
	// The email logo: public, no sign-in, cached for a day by browsers and by the mail clients' image proxies. Nothing else lives under /email-assets.
	async headers() {
		return [{ source: '/email-assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] }];
	},
	images: {
		domains: ['utfs.io', 'images.unsplash.com', 'img.clerk.com'],
	},
};

module.exports = nextConfig;

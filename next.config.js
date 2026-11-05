const buf = require('buffer');
if (!buf.SlowBuffer) {
	buf.SlowBuffer = buf.Buffer;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.EDULABS_STANDALONE === '1' ? { output: 'standalone', experimental: { cpus: 2 } } : {}),
	...(process.env.EDULABS_DIST_DIR ? { distDir: process.env.EDULABS_DIST_DIR } : {}),
	images: {
		domains: ['utfs.io', 'images.unsplash.com', 'img.clerk.com'],
	},
};

module.exports = nextConfig;

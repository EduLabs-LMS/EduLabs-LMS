import 'server-only';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
/** Prepared byte boundary only. No upload/review RPC is enabled until its trusted adapter is configured. */
export async function normalizeWebsiteImage(input:Buffer) {
 if(!input.length||input.length>2097152)throw new Error('Image must be no larger than 2 MB.');
 const image=sharp(input,{limitInputPixels:16777216,failOn:'warning',animated:true});
 const meta=await image.metadata();
 if(!['png','jpeg','webp'].includes(meta.format??'')||!meta.width||!meta.height||meta.width<16||meta.height<16||meta.width>4096||meta.height>4096||(meta.pages??1)!==1)throw new Error('Use a single PNG, JPEG or WebP image between 16 and 4096 pixels.');
 // rotate applies EXIF orientation; sharp drops EXIF/ICC/XMP unless explicitly retained.
 const bytes=await image.rotate().webp({quality:85}).toBuffer();
 if(bytes.length>2097152)throw new Error('Normalized image exceeds 2 MB.');
 return {bytes,mime:'image/webp' as const,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}

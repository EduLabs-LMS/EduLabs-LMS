import 'server-only';
import sharp from 'sharp';
/** Decode, rather than trust a filename or a magic prefix. Never execute SVG/HTML. */
export async function validateLessonImage(bytes:Uint8Array,mime:string) {
 const image=sharp(bytes,{limitInputPixels:20_000_000,failOn:'warning'});
 const info=await image.metadata();
 const expected:Record<string,string>={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'};
 if(info.format!==expected[mime]||!info.width||!info.height||info.width>8192||info.height>8192||(info.pages??1)>1)throw Error('Unsupported or oversized image content.');
 await image.raw().toBuffer();
}

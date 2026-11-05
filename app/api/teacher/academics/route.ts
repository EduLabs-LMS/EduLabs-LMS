import { academicsHTTP } from '@/server/http/academics';
import { withServerTiming } from '@/server/http/server-timing';
export const GET = withServerTiming(academicsHTTP);
export const POST = GET;

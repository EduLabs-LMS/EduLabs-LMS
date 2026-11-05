import { communicationsPOST } from '@/server/http/communications';
import { withServerTiming } from '@/server/http/server-timing';
export const POST = withServerTiming(communicationsPOST);

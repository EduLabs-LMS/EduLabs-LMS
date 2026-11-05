import { groupsPOST } from '@/server/http/groups';
import { withServerTiming } from '@/server/http/server-timing';
export const POST = withServerTiming(groupsPOST);

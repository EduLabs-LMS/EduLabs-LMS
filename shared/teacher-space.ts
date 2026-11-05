import { z } from 'zod';
import { spaceName } from '@/shared/contracts/platform-provisioning';

/** Renaming a teaching space. Who may do it is decided by the database (the active owner), never by this shape. */
export const renameSpaceInput = z.object({ organizationId: z.string().uuid(), name: spaceName }).strict();
export type RenameSpaceInput = z.infer<typeof renameSpaceInput>;

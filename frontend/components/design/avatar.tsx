import Image from 'next/image';
import { avatarTint, initials } from '@/shared/design';
import { Icon } from './icon';

/** Initials on a tint chosen from a stable hash of the id. Nothing about the person is stored for it. A photo, when the account has one, takes its place. */
export function Avatar({ id, name, imageUrl }: { id: string; name?: string | null; imageUrl?: string | null }) {
  const letters = initials(name);
  return <span aria-hidden data-avatar className={`d-avatar d-avatar--${avatarTint(id)}`}>
    {imageUrl ? <Image alt="" unoptimized src={imageUrl} width={36} height={36} /> : letters ? <bdi>{letters}</bdi> : <Icon name="students" />}
  </span>;
}

import { Video, Radio, Users, Presentation, Headphones, MessageCircle } from 'lucide-react';
import type { groupStreamIcons } from '@/shared/contracts/groups';

const icons = { video: Video, radio: Radio, users: Users, presentation: Presentation, headphones: Headphones, messages: MessageCircle };
export function StreamBubble({ label, icon }: { label: string; icon: typeof groupStreamIcons[number] }) {
 const Icon = icons[icon] ?? Video;
 return <span className="inline-flex items-center gap-2"><Icon aria-hidden className="h-4 w-4 shrink-0 text-cyan-400"/><span>{label}</span></span>;
}

import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherAccountSection } from '@/frontend/features/teacher-settings/account-section';

export default async function Page() {
  const context = await staffContext();
  // Every active space the teacher belongs to; only an owner is offered Rename (the database decides again on save).
  const spaces = context.organizations
    .filter(o => o.status === 'active')
    .flatMap(o => { const m = context.memberships.find(x => x.organization_id === o.id && x.status === 'active'); return m ? [{ id: o.id, name: o.name, owner: m.role === 'owner' }] : []; });
  return <TeacherAccountSection spaces={spaces} />;
}

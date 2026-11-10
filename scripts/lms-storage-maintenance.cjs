// Operator-only maintenance; never imported by the application. Dry-run default.
// Requires an explicitly supplied development maintenance connection, not DATABASE_URL.
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');
async function main() {
  const url = process.env.LMS_MAINTENANCE_DATABASE_URL;
  const ref = process.env.LMS_MAINTENANCE_PROJECT_REF;
  if (!url || !ref || process.env.LMS_MAINTENANCE_ENV !== 'development') throw new Error('Explicit development maintenance configuration required');
  const connection = new URL(url);
  if (!connection.hostname.includes(`.${ref}.`) && !decodeURIComponent(connection.username).endsWith(`.${ref}`)) throw new Error('Connection does not match maintenance project');
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const candidates = await db.$queryRaw`select id from private.expired_media_uploads where storage_provider='supabase' order by upload_expires_at limit 100`;
    const orphans = await db.$queryRaw`select count(*)::integer as count from storage.objects o where bucket_id in ('lms-course-media','lms-submissions') and not exists(select 1 from public.media_assets m where m.bucket=o.bucket_id and m.object_path=o.name)`;
    // Homework: student photos a manager deleted (Delete images) whose file is still in Storage, because the server's removal failed
    // or was cut short. The row stays 'deleted' for good (grades, marks and notes keep pointing at it); only the object goes.
    const deletedHomework = await db.$queryRaw`select u.path from private.expired_homework_uploads u
      where u.status='deleted' and exists(select 1 from storage.objects o where o.bucket_id='lms-homework' and o.name=u.path)
      order by u.path limit 1000`;
    console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', expiredOrAbandoned: candidates.length, deletedHomeworkFiles: deletedHomework.length, unregisteredObjectsForManualReview: orphans[0].count }));
    if (!process.argv.includes('--apply')) return;
    const secret = process.env.LMS_MAINTENANCE_SECRET_KEY;
    if (!secret) throw new Error('Operator-only maintenance credential required for Storage API');
    const client = createClient(`https://${ref}.supabase.co`, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    let cleaned = 0;
    for (const { id } of candidates) {
      // UPDATE locks the row and rechecks status/references. Future references
      // require ready assets; expired completion is denied. Do not delete rows.
      const claimed = await db.$queryRaw`update public.media_assets m set status='archived'
        where id=${id}::uuid and storage_provider='supabase' and ((status='pending' and upload_expires_at<now()) or status='archived')
        and not exists(select 1 from public.lesson_blocks b where b.media_asset_id=m.id)
        and not exists(select 1 from public.assessment_responses r where r.media_asset_id=m.id)
        returning bucket,object_path`;
      if (!claimed.length) continue;
      const { error } = await client.storage.from(claimed[0].bucket).remove([claimed[0].object_path]);
      if (error) throw new Error('Storage cleanup failed; archived metadata retained for retry');
      cleaned++;
    }
    let homeworkRemoved = 0;
    for (let i = 0; i < deletedHomework.length; i += 100) {
      const chunk = deletedHomework.slice(i, i + 100).map(r => r.path);
      const { data, error } = await client.storage.from('lms-homework').remove(chunk);
      if (error) throw new Error('Homework Storage cleanup failed; deleted rows retained for retry');
      homeworkRemoved += data?.length ?? 0;
    }
    console.log(JSON.stringify({ cleaned, homeworkRemoved, metadataDeleted: 0 }));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('Maintenance failed; inspect local configuration and retry. Credentials and paths are intentionally omitted.'); process.exitCode = 1; });

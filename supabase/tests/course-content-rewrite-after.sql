-- Disposable local PostgreSQL only. The harness runs this just after migration 20261106130000: the one-time rewrite of existing rows. Removes its own rows at the end.
create temp table ccr_results(name text primary key);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.ccr_results values(label);end$$;
create function pg_temp.labels(course text) returns text language sql set search_path='' as $$
 select string_agg(title||':'||group_type||':'||chapter_number||':'||position,'|' order by position) from public.course_modules where course_id=course::uuid$$;
select pg_temp.ok(pg_temp.labels('7c000000-0000-0000-0000-000000000002')='First:Chapter:1:0|Second:Chapter:2:1|Third:Chapter:3:2','a chosen type and number, no number and gaps all become Chapter 1, 2, 3, in the same order');
select pg_temp.ok(pg_temp.labels('7c000000-0000-0000-0000-000000000003')='Archived chapter:Chapter:1:0|Another archived chapter:Chapter:2:1','an archived course is rewritten too, once');
select pg_temp.ok(pg_temp.labels('7c000000-0000-0000-0000-000000000004')='In order:Chapter:1:0','a chapter already right stays right');
select pg_temp.ok((select summary='Kept summary' and description='Kept description' from public.course_modules where id='7c000000-0000-0000-0000-000000000010'),'the rest of a chapter is untouched');
select pg_temp.ok((select module_id='7c000000-0000-0000-0000-000000000011' and position=4 from public.lessons where id='7c000000-0000-0000-0000-000000000020'),'a lesson stays in its chapter, at its position');
select pg_temp.ok((select module_id='7c000000-0000-0000-0000-000000000014' and position=2 and status='published' from public.lessons where id='7c000000-0000-0000-0000-000000000021'),'in an archived course as well');
select pg_temp.ok(not exists(select 1 from public.course_modules where chapter_number is null or chapter_number<>position+1 or group_type<>'Chapter'),'every chapter in the database has the right label, the seed''s too');
select pg_temp.ok(not exists(select 1 from (select position,row_number() over (partition by course_id order by position)-1 rn from public.course_modules) x where position<>rn),'and no course has a gap');
select count(*) as course_content_rewrite_tests from ccr_results;
delete from public.courses where organization_id='7c000000-0000-0000-0000-000000000001';
delete from public.organizations where id='7c000000-0000-0000-0000-000000000001';
drop table ccr_results;
drop function pg_temp.ok(boolean,text);
drop function pg_temp.labels(text);

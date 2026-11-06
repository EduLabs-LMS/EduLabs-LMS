-- Disposable local PostgreSQL only. The harness runs this just before migration 20261106130000, then course-content-rewrite-after.sql just after it.
-- Synthetic chapters as they could stand before the rewrite: the old default label, a chosen type and number, no number, gaps in the positions, and an archived course.
insert into public.organizations(id,name,slug) values('7c000000-0000-0000-0000-000000000001','Synthetic rewrite','ccs-rewrite');
insert into public.courses(id,organization_id,title,slug,status,visibility) values
 ('7c000000-0000-0000-0000-000000000002','7c000000-0000-0000-0000-000000000001','Gaps','ccs-rewrite-gaps','published','private'),
 ('7c000000-0000-0000-0000-000000000003','7c000000-0000-0000-0000-000000000001','Archived','ccs-rewrite-archived','archived','private'),
 ('7c000000-0000-0000-0000-000000000004','7c000000-0000-0000-0000-000000000001','Already in order','ccs-rewrite-order','draft','private');
insert into public.course_modules(id,course_id,title,position,group_type,chapter_number,summary,description) values
 ('7c000000-0000-0000-0000-000000000010','7c000000-0000-0000-0000-000000000002','First',0,'Module',1,'Kept summary','Kept description'),
 ('7c000000-0000-0000-0000-000000000011','7c000000-0000-0000-0000-000000000002','Second',3,'Week',37,'',''),
 ('7c000000-0000-0000-0000-000000000012','7c000000-0000-0000-0000-000000000002','Third',7,'Special Review',null,'',''),
 ('7c000000-0000-0000-0000-000000000013','7c000000-0000-0000-0000-000000000003','Archived chapter',2,'Module',1,'',''),
 ('7c000000-0000-0000-0000-000000000014','7c000000-0000-0000-0000-000000000003','Another archived chapter',5,'Module',1,'',''),
 ('7c000000-0000-0000-0000-000000000015','7c000000-0000-0000-0000-000000000004','In order',0,'Chapter',1,'','');
insert into public.lessons(id,module_id,title,position,status) values
 ('7c000000-0000-0000-0000-000000000020','7c000000-0000-0000-0000-000000000011','A lesson stays in its chapter',4,'draft'),
 ('7c000000-0000-0000-0000-000000000021','7c000000-0000-0000-0000-000000000014','So does one in an archived course',2,'published');

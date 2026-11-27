-- Disposable local PostgreSQL only. The harness runs this just before migration 20261127130000, then homework-marks-after.sql just after it.
-- Synthetic rows as they could stand on the dev database before the owner's 2026-11-27 rules (the "Faraday homework 1" case and its neighbours):
--   A: one single-choice question, fix mistakes, solutions 'after_deadline', handed in late: corrected by the rule (score 1) but never released.
--   B: a choice and an essay, the essay marked by the teacher and not released yet: it must stay for the teacher to release.
--   C: no essay, but the try is still under correction (an old legacy-style row): left alone (only a finished self-marked correction is released).
insert into public.organizations(id,name,slug) values('7d000000-0000-0000-0000-000000000001','Synthetic marks backfill','hmb-backfill');
insert into public.profiles(id,display_name) values('7d000000-0000-0000-0000-000000000002','Synthetic teacher'),('7d000000-0000-0000-0000-000000000003','Synthetic student');
insert into public.courses(id,organization_id,title,slug,status,visibility) values('7d000000-0000-0000-0000-000000000004','7d000000-0000-0000-0000-000000000001','Synthetic Physics','hmb-physics','published','private');
insert into public.course_modules(id,course_id,title,position,group_type,chapter_number) values('7d000000-0000-0000-0000-000000000005','7d000000-0000-0000-0000-000000000004','Electricity',0,'Chapter',1);
insert into public.lessons(id,module_id,title,position,status) values('7d000000-0000-0000-0000-000000000006','7d000000-0000-0000-0000-000000000005','Faraday',0,'published');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values('7d000000-0000-0000-0000-000000000007','7d000000-0000-0000-0000-000000000004','Synthetic run','scheduled','active');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values('7d000000-0000-0000-0000-000000000007','7d000000-0000-0000-0000-000000000003','active',now()-interval '10 days');
insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,title,mode,status,uses_marks,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,revision,created_by) values
 ('7d000000-0000-0000-0000-0000000000a0','7d000000-0000-0000-0000-0000000000a0','7d000000-0000-0000-0000-000000000004','7d000000-0000-0000-0000-000000000007','7d000000-0000-0000-0000-000000000006','Faraday homework 1','PLATFORM_QUESTIONS','published',true,'questions',now()-interval '2 days',true,'fix_mistakes',2,'after_deadline',3,'7d000000-0000-0000-0000-000000000002'),
 ('7d000000-0000-0000-0000-0000000000b0','7d000000-0000-0000-0000-0000000000b0','7d000000-0000-0000-0000-000000000004','7d000000-0000-0000-0000-000000000007','7d000000-0000-0000-0000-000000000006','Faraday mixed','PLATFORM_QUESTIONS','published',true,'questions',now()-interval '2 days',false,'one_time',1,'after_deadline',3,'7d000000-0000-0000-0000-000000000002'),
 ('7d000000-0000-0000-0000-0000000000c0','7d000000-0000-0000-0000-0000000000c0','7d000000-0000-0000-0000-000000000004','7d000000-0000-0000-0000-000000000007','7d000000-0000-0000-0000-000000000006','Faraday open','PLATFORM_QUESTIONS','published',true,'questions',now()+interval '2 days',false,'one_time',1,'after_hand_in',3,'7d000000-0000-0000-0000-000000000002');
insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) values
 ('7d000000-0000-0000-0000-0000000000a1','7d000000-0000-0000-0000-0000000000a0',0,'single_choice','Which law?',1,'text'),
 ('7d000000-0000-0000-0000-0000000000b1','7d000000-0000-0000-0000-0000000000b0',0,'single_choice','Which law?',1,'text'),
 ('7d000000-0000-0000-0000-0000000000b2','7d000000-0000-0000-0000-0000000000b0',1,'essay','Explain',4,'text'),
 ('7d000000-0000-0000-0000-0000000000c1','7d000000-0000-0000-0000-0000000000c0',0,'single_choice','Which law?',1,'text');
insert into public.homework_options(id,question_id,position,text) values
 ('7d000000-0000-0000-0000-0000000000a2','7d000000-0000-0000-0000-0000000000a1',0,'Faraday'),('7d000000-0000-0000-0000-0000000000a3','7d000000-0000-0000-0000-0000000000a1',1,'Ohm'),
 ('7d000000-0000-0000-0000-0000000000b3','7d000000-0000-0000-0000-0000000000b1',0,'Faraday'),('7d000000-0000-0000-0000-0000000000b4','7d000000-0000-0000-0000-0000000000b1',1,'Ohm'),
 ('7d000000-0000-0000-0000-0000000000c2','7d000000-0000-0000-0000-0000000000c1',0,'Faraday'),('7d000000-0000-0000-0000-0000000000c3','7d000000-0000-0000-0000-0000000000c1',1,'Ohm');
insert into private.homework_keys(question_id,correct_ids,model_answer) values
 ('7d000000-0000-0000-0000-0000000000a1',array['7d000000-0000-0000-0000-0000000000a2'::uuid],''),('7d000000-0000-0000-0000-0000000000b1',array['7d000000-0000-0000-0000-0000000000b3'::uuid],''),
 ('7d000000-0000-0000-0000-0000000000b2','{}','Model'),('7d000000-0000-0000-0000-0000000000c1',array['7d000000-0000-0000-0000-0000000000c2'::uuid],'');
insert into public.homework_submissions(id,assignment_id,user_id,number,status,revision,submitted_at,missed_deadline) values
 ('7d000000-0000-0000-0000-0000000000a9','7d000000-0000-0000-0000-0000000000a0','7d000000-0000-0000-0000-000000000003',1,'submitted',2,now()-interval '1 day',true),
 ('7d000000-0000-0000-0000-0000000000b9','7d000000-0000-0000-0000-0000000000b0','7d000000-0000-0000-0000-000000000003',1,'submitted',2,now()-interval '3 days',false),
 ('7d000000-0000-0000-0000-0000000000c9','7d000000-0000-0000-0000-0000000000c0','7d000000-0000-0000-0000-000000000003',1,'submitted',2,now()-interval '1 hour',false);
insert into private.homework_marks(submission_id,question_id,points) values
 ('7d000000-0000-0000-0000-0000000000a9','7d000000-0000-0000-0000-0000000000a1',1),
 ('7d000000-0000-0000-0000-0000000000b9','7d000000-0000-0000-0000-0000000000b1',1),('7d000000-0000-0000-0000-0000000000b9','7d000000-0000-0000-0000-0000000000b2',3),
 ('7d000000-0000-0000-0000-0000000000c9','7d000000-0000-0000-0000-0000000000c1',0);
insert into private.homework_corrections(submission_id,status,score,revision,corrected_by,corrected_at) values
 ('7d000000-0000-0000-0000-0000000000a9','corrected',1,0,null,null),
 ('7d000000-0000-0000-0000-0000000000b9','corrected',4,1,'7d000000-0000-0000-0000-000000000002',now()-interval '1 day'),
 ('7d000000-0000-0000-0000-0000000000c9','under_correction',null,0,null,null);

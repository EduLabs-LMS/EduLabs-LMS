# Follow-up 1: teacher dashboard and sidebar cleanup (PARTIAL)

## Confirmed role table
| Role | Where | Group |
|---|---|---|
| ADMIN | legacy Prisma | Platform/developer: untouched |
| TEACHER | legacy Prisma | Teacher-side |
| ASSISTANT | legacy Prisma | Teacher-side by grouping, but no guard recognises it today; behaves as a student; permissions NOT changed, so nothing changes for it |
| STUDENT | legacy Prisma | Student: untouched |
| owner / admin | Firebase org membership | Platform: untouched |
| teacher / assistant (and course/offering staff) | Firebase org membership | Teacher-side |

## Items
1. Hero simplified for teacher-side (badge, description, card removed; heading + 2 buttons stay).
2. Quick Administrative Actions removed for teacher-side. Reachability: users via sidebar, homework via button + sidebar, curriculum via Self-learning.
3. Available & Upcoming Assessments removed for teacher-side. Exams stay in the sidebar.
4. NOT DONE. No existing waitlist on/off flag exists; stopped per instructions.
5. Attendance card and link row removed for teacher-side. Academic programs, Website studio and Create a course (New Lesson) are still reachable from the Self-learning course list page.
6. Teacher courses tab hidden for teacher-side; Self-learning shows the course management view; sub-routes at /self-learning/[courseId] and /self-learning/[courseId]/chapters/[chapterId]; old /teacher/courses/** returns 404 for teacher-side (no redirect).

Platform roles keep /teacher/courses and their two tabs. Every in-app link uses the role-aware path.

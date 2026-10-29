# Handoff state — not yet approved for Claude implementation

V1 definition and checklist: [V1.md](V1.md). Integration branch: claude/teacher-v1.

Branch: claude/admin-provisioning-v1. Base HEAD: d3451e52c13a64f28d865ace8c9bd32059b4e696
(the committed clean foundation; the former codex/teacher-ui-clean-foundation text at
fa67875 was stale). Teacher Provisioning V1 (platform admin) is in the working
tree, uncommitted, for owner review; its migration is unapplied. Do not pretend HEAD
contains these changes. No push/merge/deployment has occurred. Next milestone not started.

Read PROJECT_STATE, ARCHITECTURE, DECISIONS, TEACHER_UI_SPEC, TESTING and the preparation
review. RETIRED_TEACHER_UI.json lists every deleted teacher presentation path with its
baseline direct consumers. The review lists every neutral scaffold and modified file.

Codex owns foundation preparation and existing backend contracts. Claude begins only
after explicit owner handoff approval, with the first scoped teacher course-list task.
No implicit permission to change APIs, RLS, provider settings, migrations or release.

Outstanding release gates: independent review of removed/replaced source; pin a final
commit; approve teacher UI scope; rebuild screens incrementally; controlled real
Firebase/Supabase acceptance, email delivery and deployment validation separately.
Teacher management is intentionally unavailable until replaced. Student synthetic
acceptance is not real-provider acceptance; no customer data was used.

## Update 2026-10-29
Teacher Home, menu, Settings and Groups & Classes are built (see TEACHER_UI_SPEC.md, "Built so far") on branch
claude/teacher-settings-groups, after claude/demo-spaces. Owner approval is still needed for any push beyond that branch, merge, PR,
deploy, migration or provider change. Next candidates, each needing its own approval: Create/Edit Group, Take attendance and the
per-session screen, Reports (replacing its "Coming soon" item), Students, Homework and Exams screens. Do not resurrect retired
components; do not add legacy paths to the middleware allow-list.


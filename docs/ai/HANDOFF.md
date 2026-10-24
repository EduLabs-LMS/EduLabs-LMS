# Handoff state — not yet approved for Claude implementation

Branch: codex/teacher-ui-clean-foundation.
Starting/HEAD commit: fa67875fdab88f0fc640804e2f96b6aa7c44b0c1.
Candidate changes are uncommitted for owner review. Pin the resulting independently
reviewed commit before a portable source handoff; do not pretend HEAD contains these
working-tree changes. No push/merge/deployment has occurred.

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

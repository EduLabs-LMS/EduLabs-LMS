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

## Update 2026-11-05: design foundation

Branch `claude/design-v2-foundation`, from `claude/teacher-v1`, pushed as a new branch, not merged or deployed. Classic and New looks behind a per-person switch, the new frame, Courses at `/teacher/courses`, Settings in the main shell, Home rebuilt. Decisions: DECISIONS.md, "Design foundation". Next step: the owner and co-founder compare the looks and choose; no screen beyond Home and the frame was rebuilt.

## Update 2026-11-05: owner feedback on the New look

Same branch, `claude/design-v2-foundation`, not merged or deployed. New now carries Classic's lime pill, edge and rounded shapes; the logo has no box; Homework, Exams and Reports show with a Soon tag; New has its motion; the logo plays on every fresh opening of the site and replaces the old landing splash; Home has a countdown. Decisions: DECISIONS.md, "Owner feedback on the New look". Next step: the owner judges it on staging.

## Update 2026-11-06: owner feedback after testing New

Same branch, `claude/design-v2-foundation`, not merged or deployed. Both looks stay permanently, so every screen has to work in both. New this round: the credits in the owner's order; a help line for teachers in the footer; a menu that changes in place; a logo at 3:1 or more everywhere; `Switch`, `ChoiceGroup` and `Select` in place of native controls; "Edit attendance" in the page header. Decisions: DECISIONS.md, "Owner feedback after testing New".

## Update 2026-11-06: every teacher screen on the component system

Same branch, `claude/design-v2-foundation`, not merged or deployed. Every teacher screen is rebuilt on the design components in both looks, one commit each. New is the default for a browser that has not chosen, and its tokens now need the teacher shell, so student pages keep Classic values. Next for the owner: check New on staging, including whether existing teachers should get New by default, since a cookie cannot tell them from new ones.

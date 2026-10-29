# Current development state — 2026-10-24 (Africa/Cairo)

V1 definition and checklist: [V1.md](V1.md). Integration branch: claude/teacher-v1.

- Repository: EduLabs-LMS/EduLabs-LMS.
- Branch: claude/admin-provisioning-v1 (worktree .local/worktrees/admin-provisioning-v1).
- Base HEAD: d3451e52c13a64f28d865ace8c9bd32059b4e696 (the committed clean teacher-UI
  foundation, itself on top of fa67875). Correction: earlier text named branch
  codex/teacher-ui-clean-foundation at fa67875 as uncommitted; that preparation is
  committed as d3451e5.
- Teacher Provisioning V1 (Platform Admin) and Teacher Invitation Delivery are implemented on
  branch claude/teacher-invitation-delivery (pending review; not merged, not deployed). Implemented:
  invitation acceptance page (/teacher-invitation, with a display-name step), admin Send/Copy/Replace/Revoke,
  e-mail delivery through Brevo (BREVO_API_KEY + AUTH_EMAIL_FROM, as the branded auth e-mail) with honest delivery status. Migrations 20261024120000 and
  20261025100000 (migration 33) are applied to the DEV Supabase project only (not staging, not production). Nothing was live-tested
  with real Firebase, Supabase or Brevo; verification used a disposable local PostgreSQL and a
  fictional-HTTP browser harness. Not built: workspace reset, a dedicated teacher onboarding screen.
  See docs/platform-admin-teacher-provisioning.md.
- Owner authorization: issue #20 comment 6383545623 and the explicit chat instruction.
- Neither friend branch 16acf2f nor integration merge f1be2f8 was merged/cherry-picked.
- Continue Learning fix d96c40e was selectively ported, retaining baseline styles.
- Staging-only successful-login soft replace and landing-only splash behavior were
  narrowly ported; no email/provider changes or PR #19 content were imported.
- 50 teacher-only presentation files are removed; exact paths and baseline consumers
  are in RETIRED_TEACHER_UI.json. Shared views retain student behavior.
- Old teacher administration is intentionally unavailable on this branch. APIs and
  contextual authorization remain. It is NOT a deployable teacher-pilot release.
- Baseline had 31 local migration files; Teacher Provisioning V1 adds a 32nd (applied to the DEV Supabase project only). No connected database was queried or changed
  in this preparation. The prior audit counted 31 development migrations; the ledger
  records six historical version mappings. Do not replay or repair history.
- main, staging/integration, other worktrees and PR #19 are outside this change.
- Deployed staging is a separate candidate; local build success does not update it.

Read docs/teacher-ui-clean-foundation-review.md for actual tests and limitations.
Historical reports describing teacher editors/builds are not claims those screens
remain available here. Real provider/email/push acceptance has not run for this tree.

## Update 2026-10-29: teacher Settings and Groups & Classes
- Branch chain (local until the owner approves a push): claude/demo-spaces -> claude/teacher-settings-groups. Staging runs
  manager v1.6.0 with migrations 32, 33 and 34 approved (owner statement; see docs/platform-admin-staging-release.md).
- Built on top of the foundation: teacher Home, the six-item menu with the profile footer and Settings cog, the Settings area
  (My account, Courses, Language and appearance, Notifications) and Groups & Classes (list and one Group). Details and the
  buttons that exist or were left out: TEACHER_UI_SPEC.md.
- No migration, endpoint family or permission change. The demo space needs no seed change (nothing new is stored). Middleware
  allows the new pages by exact path only; lookalikes and legacy paths such as /teacher/analytics still get the catch-all.
- Verified with synthetic/loopback data and the real middleware only (scripts/teacher-settings-groups.test.cjs and
  scripts/teacher-settings-groups-browser.cjs); not real Firebase/Supabase acceptance. Not deployed.


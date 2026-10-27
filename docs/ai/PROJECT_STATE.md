# Current development state — 2026-10-24 (Africa/Cairo)

- Repository: EduLabs-LMS/EduLabs-LMS.
- Branch: claude/admin-provisioning-v1 (worktree .local/worktrees/admin-provisioning-v1).
- Base HEAD: d3451e52c13a64f28d865ace8c9bd32059b4e696 (the committed clean teacher-UI
  foundation, itself on top of fa67875). Correction: earlier text named branch
  codex/teacher-ui-clean-foundation at fa67875 as uncommitted; that preparation is
  committed as d3451e5.
- Teacher Provisioning V1 (Platform Admin) and Teacher Invitation Delivery are implemented on
  branch claude/teacher-invitation-delivery (pending review; not merged, not deployed). Implemented:
  invitation acceptance page (/teacher-invitation, with a display-name step), admin Send/Copy/Replace/Revoke,
  e-mail delivery through Resend with honest delivery status. Migrations 20261024120000 and
  20261025100000 (migration 33) are authored but NOT applied to any database. Nothing was live-tested
  with real Firebase, Supabase or Resend; verification used a disposable local PostgreSQL and a
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
- Baseline had 31 local migration files; Teacher Provisioning V1 adds a 32nd (unapplied). No connected database was queried or changed
  in this preparation. The prior audit counted 31 development migrations; the ledger
  records six historical version mappings. Do not replay or repair history.
- main, staging/integration, other worktrees and PR #19 are outside this change.
- Deployed staging is a separate candidate; local build success does not update it.

Read docs/teacher-ui-clean-foundation-review.md for actual tests and limitations.
Historical reports describing teacher editors/builds are not claims those screens
remain available here. Real provider/email/push acceptance has not run for this tree.

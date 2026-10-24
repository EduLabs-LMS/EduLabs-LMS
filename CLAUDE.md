# EduLabs development entry point

Read all six onboarding documents before implementation:

- `docs/ai/PROJECT_STATE.md`
- `docs/ai/ARCHITECTURE.md`
- `docs/ai/DECISIONS.md`
- `docs/ai/TEACHER_UI_SPEC.md`
- `docs/ai/TESTING.md`
- `docs/ai/HANDOFF.md`

This foundation starts at fa67875fdab88f0fc640804e2f96b6aa7c44b0c1. The friend's
teacher redesign was deliberately NOT integrated. Existing teacher screens were
removed, not hidden. Neutral authenticated routes are intentional rebuild scaffolds.
Student features, backend operations and security remain the contract.

No permission is implied to merge, push, deploy, change providers or connected data,
apply/repair migrations, import PR #19, or weaken authorization. Ask for explicit
owner approval for those actions. Never use customer records as fixtures.

Use the existing Firebase/Supabase architecture. No global teacher role, service-role
browser credential, second enrollment system or legacy identity import. Keep student
V2 design, Notifications, Settings, language/RTL, theme and Continue Learning intact.
API and database authorization, not navigation or role badges, are authoritative.

The next UI task requires owner approval of this foundation and a specific screen.
Do not resurrect retired components from Git as the new starting UI.

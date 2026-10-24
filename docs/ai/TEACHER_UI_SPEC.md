# Teacher UI rebuild contract

## Current boundary
The legacy teacher screens are removed. Neutral teacher routes keep authentication,
resource checks and build integrity while the replacement is designed. There are no
fake metrics, save buttons or fabricated success states. Do not present this scaffold
as a functioning teacher pilot. Student pages retain the approved pre-redesign V2 UI.

## Screens to rebuild incrementally, after owner approval
1. Teacher course list/dashboard and navigation.
2. Course/module/lesson/part authoring, ordering, media, draft/publication and preview.
3. Program/stage management and course classification within the same organization.
4. Student requests/invitations/enrollment administration.
5. Groups, schedules, rosters and attendance/corrections.
6. Homework authoring/correction/PDF annotations and exam authoring/grading/release.
7. Teacher website/catalog/domain administration, using existing contracts.

Reuse existing APIs and server services; do not invent endpoints, numbers or provider
capabilities. Read the relevant shared/contracts, service and SQL tests before a view.
Unknown/failed data is not an empty result. Surface 401/403, stale-write 409, validation
and retryable failure states. Respect supplied versions and capacity; bulk operations
are not atomic unless the backend explicitly guarantees it.

## Permission rules
Owners/admins manage taxonomy under existing rules. Teachers/assistants only have
existing contextual course/offering permissions; broadening them needs separate backend
approval. Keep last-owner protection and trusted/manual tenant provisioning. Staff
badges/navigation are never grants. Do not restore self-service organization creation.

## Shared behavior preserved
Student course access, direct lesson routes, playback/resources, progress/resume,
exam attempts/results/retry, homework submission/history, groups/join links/own attendance,
Notifications/push, account editing/Settings, English/Arabic/RTL and appearance stay.
Shared support flows and their technical-operator controls remain a separate feature.
The hidden student stage selector must remain hidden, with no hidden requests.

## First proposed Claude assignment
After explicit handoff approval: implement only the teacher course-list/navigation
screen using existing authorized data, with empty/error/loading and mobile states.
Preserve neutral editor routes until separately assigned. Do not import the friend's
redesign, revive deleted screens, expand permissions or begin Jitsi/email work.
